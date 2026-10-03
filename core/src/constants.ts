export const DBC_PROGRAM_ID = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/** Slots in the measured window after a pool opens: [s_open, s_open + WINDOW_SLOTS - 1]. */
export const WINDOW_SLOTS = 10;
/** Extra slots to wait past the window before finalizing, so processed-but-dropped txs can be removed. */
export const FINALIZE_LAG_SLOTS = 32;
/** Ranking eligibility (D9). */
export const MIN_WINDOWS = 20;
export const MIN_CREATORS = 5;
