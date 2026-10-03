use anchor_lang::prelude::*;

use crate::error::RouterError;
use crate::split::MAX_AUTHOR_BPS;
use crate::state::*;

#[derive(Accounts)]
pub struct SetSplit<'info> {
    pub author: Signer<'info>,

    #[account(
        mut,
        has_one = author,
        seeds = [PRESET_SEED, preset.dbc_config.as_ref()],
        bump = preset.bump,
    )]
    pub preset: Account<'info, Preset>,
}

/// Applies to future claims only; fees already split are never re-split.
pub fn set_split(ctx: Context<SetSplit>, author_bps: u16) -> Result<()> {
    require!(author_bps <= MAX_AUTHOR_BPS, RouterError::InvalidAuthorBps);
    ctx.accounts.preset.author_bps = author_bps;
    Ok(())
}
