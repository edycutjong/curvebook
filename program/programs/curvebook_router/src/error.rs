use anchor_lang::prelude::*;

#[error_code]
pub enum RouterError {
    #[msg("author_bps must be <= 9000")]
    InvalidAuthorBps,
    #[msg("Account is not owned by the Meteora DBC program")]
    NotDbcAccount,
    #[msg("Account data does not match the expected DBC account type")]
    InvalidDbcAccount,
    #[msg("DBC config fee_claimer is not this preset's vault PDA")]
    FeeClaimerMismatch,
    #[msg("DBC config must collect fees in the quote token (collect_fee_mode = 0)")]
    UnsupportedCollectFeeMode,
    #[msg("DBC pool belongs to a different config than this preset")]
    PoolConfigMismatch,
    #[msg("Nothing was claimed from DBC")]
    NothingToClaim,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
