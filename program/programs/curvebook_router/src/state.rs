use anchor_lang::prelude::*;

pub const PRESET_SEED: &[u8] = b"preset";
pub const VAULT_SEED: &[u8] = b"vault";

/// One registered DBC config ("preset"). Its vault PDA is the config's DBC fee claimer.
#[account]
#[derive(InitSpace)]
pub struct Preset {
    pub author: Pubkey,
    pub dbc_config: Pubkey,
    pub author_bps: u16,
    pub treasury: Pubkey,
    pub quote_mint: Pubkey,
    /// Pool-creation fees claimed — one per launch on this preset.
    pub launches_claimed: u64,
    pub total_split_quote: u64,
    pub total_split_lamports: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[event]
pub struct RoyaltySplit {
    pub preset: Pubkey,
    pub pool: Pubkey,
    /// 0 = partner trading fee (quote token), 1 = partner pool-creation fee (lamports).
    pub kind: u8,
    pub claimed: u64,
    pub author_amount: u64,
    pub treasury_amount: u64,
}

pub const KIND_TRADING: u8 = 0;
pub const KIND_CREATION: u8 = 1;
