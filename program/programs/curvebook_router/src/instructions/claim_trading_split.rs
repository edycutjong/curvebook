use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::dbc::{self, DBC_EVENT_AUTHORITY, DBC_POOL_AUTHORITY, DBC_PROGRAM_ID};
use crate::error::RouterError;
use crate::split::split;
use crate::state::*;

#[derive(Accounts)]
pub struct ClaimTradingSplit<'info> {
    #[account(
        mut,
        has_one = dbc_config,
        has_one = quote_mint,
        seeds = [PRESET_SEED, dbc_config.key().as_ref()],
        bump = preset.bump,
    )]
    pub preset: Box<Account<'info, Preset>>,

    /// CHECK: pinned to preset.dbc_config by has_one; DBC validates it against the pool.
    pub dbc_config: UncheckedAccount<'info>,

    /// CHECK: owner, discriminator and `config` field checked in the handler (I4).
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,

    /// CHECK: system-owned PDA; signs the DBC claim as the config's fee claimer.
    #[account(seeds = [VAULT_SEED, dbc_config.key().as_ref()], bump = preset.vault_bump)]
    pub vault: UncheckedAccount<'info>,

    /// Required by DBC even though max_amount_a = 0; must be the vault's, so a stray
    /// base payout could never leave the router's custody.
    #[account(
        mut,
        token::mint = base_mint,
        token::authority = vault,
        token::token_program = token_base_program,
    )]
    pub vault_base_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = quote_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_quote_program,
    )]
    pub vault_quote_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = quote_mint,
        token::authority = preset.author,
        token::token_program = token_quote_program,
    )]
    pub author_quote_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = quote_mint,
        token::authority = preset.treasury,
        token::token_program = token_quote_program,
    )]
    pub treasury_quote_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: DBC checks it against pool.base_vault.
    #[account(mut)]
    pub base_vault: UncheckedAccount<'info>,
    /// CHECK: DBC checks it against pool.quote_vault.
    #[account(mut)]
    pub quote_vault: UncheckedAccount<'info>,

    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_base_program: Interface<'info, TokenInterface>,
    pub token_quote_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    /// CHECK: fixed DBC PDA.
    #[account(address = DBC_POOL_AUTHORITY)]
    pub dbc_pool_authority: UncheckedAccount<'info>,
    /// CHECK: fixed DBC PDA.
    #[account(address = DBC_EVENT_AUTHORITY)]
    pub dbc_event_authority: UncheckedAccount<'info>,
    /// CHECK: I4 — the only program this router ever invokes besides SPL Token.
    #[account(address = DBC_PROGRAM_ID)]
    pub dbc_program: UncheckedAccount<'info>,
}

pub fn claim_trading_split(ctx: Context<ClaimTradingSplit>, max_quote: u64) -> Result<()> {
    let a = ctx.accounts;
    require_keys_eq!(dbc::read_pool_config(&a.pool)?, a.preset.dbc_config, RouterError::PoolConfigMismatch);

    let dbc_config_key = a.preset.dbc_config;
    let vault_seeds: &[&[u8]] = &[VAULT_SEED, dbc_config_key.as_ref(), &[a.preset.vault_bump]];

    let before = a.vault_quote_account.amount;
    dbc::claim_trading_fee(
        dbc::ClaimTradingFee {
            pool_authority: &a.dbc_pool_authority,
            config: &a.dbc_config,
            pool: &a.pool,
            token_a_account: &a.vault_base_account.to_account_info(),
            token_b_account: &a.vault_quote_account.to_account_info(),
            base_vault: &a.base_vault,
            quote_vault: &a.quote_vault,
            base_mint: &a.base_mint.to_account_info(),
            quote_mint: &a.quote_mint.to_account_info(),
            fee_claimer: &a.vault,
            token_base_program: &a.token_base_program.to_account_info(),
            token_quote_program: &a.token_quote_program.to_account_info(),
            event_authority: &a.dbc_event_authority,
            program: &a.dbc_program,
        },
        0,
        max_quote,
        &[vault_seeds],
    )?;
    a.vault_quote_account.reload()?;

    // Only the delta is split, so tokens anyone donates to the vault ATA stay put (I1).
    let claimed = a
        .vault_quote_account
        .amount
        .checked_sub(before)
        .ok_or(RouterError::MathOverflow)?;
    require!(claimed > 0, RouterError::NothingToClaim);
    let (author_amount, treasury_amount) =
        split(claimed, a.preset.author_bps).ok_or(RouterError::InvalidAuthorBps)?;

    let decimals = a.quote_mint.decimals;
    for (to, amount) in [
        (a.author_quote_account.to_account_info(), author_amount),
        (a.treasury_quote_account.to_account_info(), treasury_amount),
    ] {
        if amount == 0 {
            continue;
        }
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                a.token_quote_program.to_account_info(),
                TransferChecked {
                    from: a.vault_quote_account.to_account_info(),
                    mint: a.quote_mint.to_account_info(),
                    to,
                    authority: a.vault.to_account_info(),
                },
                &[vault_seeds],
            ),
            amount,
            decimals,
        )?;
    }

    a.preset.total_split_quote = a
        .preset
        .total_split_quote
        .checked_add(claimed)
        .ok_or(RouterError::MathOverflow)?;

    emit!(RoyaltySplit {
        preset: a.preset.key(),
        pool: a.pool.key(),
        kind: KIND_TRADING,
        claimed,
        author_amount,
        treasury_amount,
    });
    Ok(())
}
