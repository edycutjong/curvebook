//! Minimal, hand-written interface to Meteora Dynamic Bonding Curve (IDL 0.2.1).
//!
//! `declare_program!` cannot ingest the DBC IDL (its bytemuck accounts fail the
//! AnyBitPattern bound), so the two CPIs and the three account fields we trust are
//! spelled out here. Offsets are for the zero-copy `repr(C)` layouts, which have no
//! implicit padding; the TS suite checks them against live mainnet accounts.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

use crate::error::RouterError;

pub const DBC_PROGRAM_ID: Pubkey = pubkey!("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
/// PDA ["pool_authority"] under DBC.
pub const DBC_POOL_AUTHORITY: Pubkey = pubkey!("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM");
/// PDA ["__event_authority"] under DBC.
pub const DBC_EVENT_AUTHORITY: Pubkey = pubkey!("8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF");

pub const POOL_CONFIG_DISC: [u8; 8] = [26, 108, 14, 123, 116, 230, 129, 43];
pub const VIRTUAL_POOL_DISC: [u8; 8] = [213, 224, 5, 209, 98, 69, 119, 92];

const IX_CLAIM_TRADING_FEE: [u8; 8] = [8, 236, 89, 49, 152, 125, 177, 81];
const IX_CLAIM_PARTNER_POOL_CREATION_FEE: [u8; 8] = [250, 238, 26, 4, 139, 10, 101, 248];

// PoolConfig (8-byte discriminator included in offsets).
const CONFIG_LEN: usize = 1048;
const CONFIG_QUOTE_MINT: usize = 8;
const CONFIG_FEE_CLAIMER: usize = 40;
const CONFIG_COLLECT_FEE_MODE: usize = 232;

// VirtualPool.
const POOL_LEN: usize = 424;
const POOL_CONFIG: usize = 72;

pub const COLLECT_FEE_MODE_QUOTE: u8 = 0;

pub struct ConfigView {
    pub quote_mint: Pubkey,
    pub fee_claimer: Pubkey,
    pub collect_fee_mode: u8,
}

fn dbc_data<'a>(ai: &'a AccountInfo, disc: &[u8; 8], min_len: usize) -> Result<std::cell::Ref<'a, &'a mut [u8]>> {
    require_keys_eq!(*ai.owner, DBC_PROGRAM_ID, RouterError::NotDbcAccount);
    let data = ai.try_borrow_data()?;
    require!(data.len() >= min_len && data[..8] == disc[..], RouterError::InvalidDbcAccount);
    Ok(data)
}

fn pubkey_at(data: &[u8], off: usize) -> Pubkey {
    Pubkey::new_from_array(data[off..off + 32].try_into().unwrap())
}

pub fn read_config(ai: &AccountInfo) -> Result<ConfigView> {
    let d = dbc_data(ai, &POOL_CONFIG_DISC, CONFIG_LEN)?;
    Ok(ConfigView {
        quote_mint: pubkey_at(&d, CONFIG_QUOTE_MINT),
        fee_claimer: pubkey_at(&d, CONFIG_FEE_CLAIMER),
        collect_fee_mode: d[CONFIG_COLLECT_FEE_MODE],
    })
}

/// Returns the config a VirtualPool was launched from.
pub fn read_pool_config(ai: &AccountInfo) -> Result<Pubkey> {
    let d = dbc_data(ai, &VIRTUAL_POOL_DISC, POOL_LEN)?;
    Ok(pubkey_at(&d, POOL_CONFIG))
}

pub struct ClaimTradingFee<'a, 'info> {
    pub pool_authority: &'a AccountInfo<'info>,
    pub config: &'a AccountInfo<'info>,
    pub pool: &'a AccountInfo<'info>,
    pub token_a_account: &'a AccountInfo<'info>,
    pub token_b_account: &'a AccountInfo<'info>,
    pub base_vault: &'a AccountInfo<'info>,
    pub quote_vault: &'a AccountInfo<'info>,
    pub base_mint: &'a AccountInfo<'info>,
    pub quote_mint: &'a AccountInfo<'info>,
    pub fee_claimer: &'a AccountInfo<'info>,
    pub token_base_program: &'a AccountInfo<'info>,
    pub token_quote_program: &'a AccountInfo<'info>,
    pub event_authority: &'a AccountInfo<'info>,
    pub program: &'a AccountInfo<'info>,
}

pub fn claim_trading_fee(
    a: ClaimTradingFee,
    max_amount_a: u64,
    max_amount_b: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // I4: the CPI target is pinned here, independent of what the caller passed.
    require_keys_eq!(*a.program.key, DBC_PROGRAM_ID, RouterError::NotDbcAccount);
    let mut data = Vec::with_capacity(24);
    data.extend_from_slice(&IX_CLAIM_TRADING_FEE);
    data.extend_from_slice(&max_amount_a.to_le_bytes());
    data.extend_from_slice(&max_amount_b.to_le_bytes());
    let ix = Instruction {
        program_id: DBC_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*a.pool_authority.key, false),
            AccountMeta::new_readonly(*a.config.key, false),
            AccountMeta::new(*a.pool.key, false),
            AccountMeta::new(*a.token_a_account.key, false),
            AccountMeta::new(*a.token_b_account.key, false),
            AccountMeta::new(*a.base_vault.key, false),
            AccountMeta::new(*a.quote_vault.key, false),
            AccountMeta::new_readonly(*a.base_mint.key, false),
            AccountMeta::new_readonly(*a.quote_mint.key, false),
            AccountMeta::new_readonly(*a.fee_claimer.key, true),
            AccountMeta::new_readonly(*a.token_base_program.key, false),
            AccountMeta::new_readonly(*a.token_quote_program.key, false),
            AccountMeta::new_readonly(*a.event_authority.key, false),
            AccountMeta::new_readonly(*a.program.key, false),
        ],
        data,
    };
    invoke_signed(
        &ix,
        &[
            a.pool_authority.clone(),
            a.config.clone(),
            a.pool.clone(),
            a.token_a_account.clone(),
            a.token_b_account.clone(),
            a.base_vault.clone(),
            a.quote_vault.clone(),
            a.base_mint.clone(),
            a.quote_mint.clone(),
            a.fee_claimer.clone(),
            a.token_base_program.clone(),
            a.token_quote_program.clone(),
            a.event_authority.clone(),
            a.program.clone(),
        ],
        signer_seeds,
    )?;
    Ok(())
}

pub struct ClaimPartnerPoolCreationFee<'a, 'info> {
    pub config: &'a AccountInfo<'info>,
    pub pool: &'a AccountInfo<'info>,
    pub fee_claimer: &'a AccountInfo<'info>,
    pub fee_receiver: &'a AccountInfo<'info>,
    pub event_authority: &'a AccountInfo<'info>,
    pub program: &'a AccountInfo<'info>,
}

pub fn claim_partner_pool_creation_fee(
    a: ClaimPartnerPoolCreationFee,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    require_keys_eq!(*a.program.key, DBC_PROGRAM_ID, RouterError::NotDbcAccount);
    let ix = Instruction {
        program_id: DBC_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*a.config.key, false),
            AccountMeta::new(*a.pool.key, false),
            AccountMeta::new_readonly(*a.fee_claimer.key, true),
            AccountMeta::new(*a.fee_receiver.key, false),
            AccountMeta::new_readonly(*a.event_authority.key, false),
            AccountMeta::new_readonly(*a.program.key, false),
        ],
        data: IX_CLAIM_PARTNER_POOL_CREATION_FEE.to_vec(),
    };
    invoke_signed(
        &ix,
        &[
            a.config.clone(),
            a.pool.clone(),
            a.fee_claimer.clone(),
            a.fee_receiver.clone(),
            a.event_authority.clone(),
            a.program.clone(),
        ],
        signer_seeds,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pinned_pdas_match_derivation() {
        let (ea, _) = Pubkey::find_program_address(&[b"__event_authority"], &DBC_PROGRAM_ID);
        assert_eq!(ea, DBC_EVENT_AUTHORITY);
        let (pa, _) = Pubkey::find_program_address(&[b"pool_authority"], &DBC_PROGRAM_ID);
        assert_eq!(pa, DBC_POOL_AUTHORITY);
    }

    #[test]
    fn discriminators_match_anchor_hash() {
        use anchor_lang::solana_program::hash::hash;
        let d = |s: &str| -> [u8; 8] { hash(s.as_bytes()).to_bytes()[..8].try_into().unwrap() };
        assert_eq!(d("account:PoolConfig"), POOL_CONFIG_DISC);
        assert_eq!(d("account:VirtualPool"), VIRTUAL_POOL_DISC);
        assert_eq!(d("global:claim_trading_fee"), IX_CLAIM_TRADING_FEE);
        assert_eq!(d("global:claim_partner_pool_creation_fee"), IX_CLAIM_PARTNER_POOL_CREATION_FEE);
    }
}
