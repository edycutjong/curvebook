// Mirrors @curvebook/core constants for client bundles, which must not import core
// (it pulls node:crypto and the Anchor coder). test/constants.test.ts keeps them in sync.
export const WINDOW_SLOTS = 10;
export const MIN_WINDOWS = 20;
export const MIN_CREATORS = 5;
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const ROUTER_PROGRAM_ID = "4bjaHzaDTYxKiJ7fTMWTyMbHkQtG8t1rc8nNcHHk4iKd";
