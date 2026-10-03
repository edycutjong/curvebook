# Spike S3 — decode DBC events from mainnet transactions

Run: `npx tsx scripts/spikes/s3-decode.ts` (keyless public RPC; `RPC_URL` overrides).

Result on 2026-10-04 (slots ≈ 453,064,600–453,065,140, ~650 transactions scanned):

| Decoded | Count |
|---|---|
| `EvtSwap2`, direct `swap`/`swap2` ix, payer paired | 295 |
| `EvtSwap2`, swap invoked by another program (CPI), payer paired | 13 |
| `EvtInitializePool` | 2 |
| `EvtCurveComplete` | 1 |

Unpaired payers: 0. In all four saved fixtures (`core/test/fixtures/`) the decoded payer/creator equals the
transaction's fee payer, including the CPI-routed buy.

Findings:
- Mainnet now carries **v1 transactions**; `getTransaction` needs `maxSupportedTransactionVersion: 1`, and the
  decoder handles the v1 message shape unchanged.
- `swap` emits **both** `EvtSwap` and `EvtSwap2`; only `EvtSwap2` is counted, so a buy is never counted twice.
- A pool's creation tx bundles the creator's first buy (`Instruction: Swap` right after
  `InitializeVirtualPoolWithSplToken`), so the first buy and the pool share a slot.
