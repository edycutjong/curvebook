//! curvebook_router — fee claimer for Meteora DBC configs ("presets").
//!
//! Each preset's DBC config names this program's vault PDA as `fee_claimer`. Anyone may
//! crank a claim; the router pulls the partner fee out of DBC and splits it between the
//! preset author and the treasury in the same instruction, so the vault never holds a
//! balance between transactions.

use anchor_lang::prelude::*;

pub mod dbc;
pub mod error;
pub mod instructions;
pub mod split;
pub mod state;

use instructions::*;

declare_id!("4bjaHzaDTYxKiJ7fTMWTyMbHkQtG8t1rc8nNcHHk4iKd");

#[program]
pub mod curvebook_router {
    use super::*;

    pub fn register_preset(ctx: Context<RegisterPreset>, author_bps: u16, treasury: Pubkey) -> Result<()> {
        instructions::register_preset(ctx, author_bps, treasury)
    }

    pub fn claim_trading_split(ctx: Context<ClaimTradingSplit>, max_quote: u64) -> Result<()> {
        instructions::claim_trading_split(ctx, max_quote)
    }

    pub fn claim_creation_split(ctx: Context<ClaimCreationSplit>) -> Result<()> {
        instructions::claim_creation_split(ctx)
    }

    pub fn set_split(ctx: Context<SetSplit>, author_bps: u16) -> Result<()> {
        instructions::set_split(ctx, author_bps)
    }
}
