use anchor_lang::prelude::*;

use crate::dbc::{self, COLLECT_FEE_MODE_QUOTE};
use crate::error::RouterError;
use crate::split::MAX_AUTHOR_BPS;
use crate::state::*;

#[derive(Accounts)]
pub struct RegisterPreset<'info> {
    #[account(mut)]
    pub author: Signer<'info>,

    /// The DBC config keypair must co-sign. Its fee claimer is a public, derivable PDA, so
    /// without this anyone could front-run the creator and register themselves as author;
    /// the config key only ever signs in the creator's own `create_config` transaction.
    /// CHECK: owner, discriminator and fields are validated in the handler.
    pub dbc_config: Signer<'info>,

    /// CHECK: system-owned PDA with no data; only its address matters here.
    #[account(seeds = [VAULT_SEED, dbc_config.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,

    #[account(
        init,
        payer = author,
        space = 8 + Preset::INIT_SPACE,
        seeds = [PRESET_SEED, dbc_config.key().as_ref()],
        bump,
    )]
    pub preset: Account<'info, Preset>,

    pub system_program: Program<'info, System>,
}

pub fn register_preset(ctx: Context<RegisterPreset>, author_bps: u16, treasury: Pubkey) -> Result<()> {
    require!(author_bps <= MAX_AUTHOR_BPS, RouterError::InvalidAuthorBps);

    let config = dbc::read_config(&ctx.accounts.dbc_config.to_account_info())?;
    // I3: the router can only ever claim for configs that already route their fees to it.
    require_keys_eq!(config.fee_claimer, ctx.accounts.vault.key(), RouterError::FeeClaimerMismatch);
    // Base-token fees would need a second split path and price exposure; v1 is quote-only.
    require!(
        config.collect_fee_mode == COLLECT_FEE_MODE_QUOTE,
        RouterError::UnsupportedCollectFeeMode
    );

    ctx.accounts.preset.set_inner(Preset {
        author: ctx.accounts.author.key(),
        dbc_config: ctx.accounts.dbc_config.key(),
        author_bps,
        treasury,
        quote_mint: config.quote_mint,
        launches_claimed: 0,
        total_split_quote: 0,
        total_split_lamports: 0,
        bump: ctx.bumps.preset,
        vault_bump: ctx.bumps.vault,
    });
    Ok(())
}
