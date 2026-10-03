use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::dbc::{self, DBC_EVENT_AUTHORITY, DBC_PROGRAM_ID};
use crate::error::RouterError;
use crate::split::split;
use crate::state::*;

#[derive(Accounts)]
pub struct ClaimCreationSplit<'info> {
    #[account(
        mut,
        has_one = dbc_config,
        has_one = author,
        has_one = treasury,
        seeds = [PRESET_SEED, dbc_config.key().as_ref()],
        bump = preset.bump,
    )]
    pub preset: Account<'info, Preset>,

    /// CHECK: pinned to preset.dbc_config by has_one.
    pub dbc_config: UncheckedAccount<'info>,

    /// CHECK: owner, discriminator and `config` field checked in the handler (I4).
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,

    /// CHECK: system-owned PDA; DBC fee claimer and fee receiver.
    #[account(mut, seeds = [VAULT_SEED, dbc_config.key().as_ref()], bump = preset.vault_bump)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: pinned by has_one; receives lamports only.
    #[account(mut)]
    pub author: UncheckedAccount<'info>,
    /// CHECK: pinned by has_one; receives lamports only.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,

    /// CHECK: fixed DBC PDA.
    #[account(address = DBC_EVENT_AUTHORITY)]
    pub dbc_event_authority: UncheckedAccount<'info>,
    /// CHECK: I4 — pinned DBC program id.
    #[account(address = DBC_PROGRAM_ID)]
    pub dbc_program: UncheckedAccount<'info>,
}

pub fn claim_creation_split(ctx: Context<ClaimCreationSplit>) -> Result<()> {
    let a = ctx.accounts;
    require_keys_eq!(dbc::read_pool_config(&a.pool)?, a.preset.dbc_config, RouterError::PoolConfigMismatch);

    let dbc_config_key = a.preset.dbc_config;
    let vault_seeds: &[&[u8]] = &[VAULT_SEED, dbc_config_key.as_ref(), &[a.preset.vault_bump]];

    let before = a.vault.lamports();
    dbc::claim_partner_pool_creation_fee(
        dbc::ClaimPartnerPoolCreationFee {
            config: &a.dbc_config,
            pool: &a.pool,
            fee_claimer: &a.vault,
            fee_receiver: &a.vault,
            event_authority: &a.dbc_event_authority,
            program: &a.dbc_program,
        },
        &[vault_seeds],
    )?;
    // Paying out exactly the delta returns the vault to its prior balance (usually 0), so
    // it never has to be rent-exempt on its own and no lamports drift into it (I1).
    let claimed = a.vault.lamports().checked_sub(before).ok_or(RouterError::MathOverflow)?;
    require!(claimed > 0, RouterError::NothingToClaim);
    let (author_amount, treasury_amount) =
        split(claimed, a.preset.author_bps).ok_or(RouterError::InvalidAuthorBps)?;

    for (to, amount) in [
        (a.author.to_account_info(), author_amount),
        (a.treasury.to_account_info(), treasury_amount),
    ] {
        if amount == 0 {
            continue;
        }
        system_program::transfer(
            CpiContext::new_with_signer(
                a.system_program.to_account_info(),
                Transfer { from: a.vault.to_account_info(), to },
                &[vault_seeds],
            ),
            amount,
        )?;
    }

    let p = &mut a.preset;
    p.launches_claimed = p.launches_claimed.checked_add(1).ok_or(RouterError::MathOverflow)?;
    p.total_split_lamports = p
        .total_split_lamports
        .checked_add(claimed)
        .ok_or(RouterError::MathOverflow)?;

    emit!(RoyaltySplit {
        preset: p.key(),
        pool: a.pool.key(),
        kind: KIND_CREATION,
        claimed,
        author_amount,
        treasury_amount,
    });
    Ok(())
}
