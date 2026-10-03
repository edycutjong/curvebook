# DX report — Meteora DBC SDK + Solami

What building Curvebook taught us about the sponsor tooling, in the order we hit it.

## Meteora Dynamic Bonding Curve
| Finding | Impact | Workaround |
|---|---|---|
| No data API for DBC: per-config launch outcomes must be indexed from `EvtSwap2` yourself | The reason Curvebook exists | Index event-CPI inner instructions |
| `EvtSwap2` has **no payer field** | A buyer can't be attributed from the event alone | Pair each event-CPI with its parent DBC `swap`/`swap2` instruction by stack height and read its `payer` account (`core/src/decode.ts`) |
| `swap` emits **both** `EvtSwap` and `EvtSwap2` | Naive decoders double-count buys | Count `EvtSwap2` only |
| Mainnet now carries **v1 transactions** | `getTransaction` fails with `maxSupportedTransactionVersion: 0` | Request version 1; message shape is unchanged |
| `getQuoteFromInputAmount` accepts a `buildCurve` output or a fetched config | Lets us quote the slot-0 toll before a pool exists | Used for the creator's slippage guard and the toll test (`core/test/toll.test.ts`) |
| `buildCurveWithLiquidityWeights` requires exactly 16 weights and throws `leftOverDelta must be less than totalLeftover` with `leftover: 0` | Not in the docs example | `leftover: 1_000_000` (0.1%) |
| `create_config` with a 16-point curve + one more instruction exceeds 1,232 bytes | Can't create and register atomically | Two transactions, both signed by the config keypair |
| `declare_program!` does not compile against IDL 0.2.1 (zero-copy account types) | The documented CPI path is unavailable on Anchor 0.31.1 | Hand-written `invoke_signed` CPI with discriminators asserted in tests |
| Trading fee in `EvtSwap2.swap_result.trading_fee` is already net of the protocol cut | Fee reconciliation needs to know this | Verified: Σ decoded `trading_fee × (100 − creator%) / 100` equals `getPoolFeeBreakdown().partner.totalQuoteFee` exactly (S8) |

## Solami
| Finding | Impact | Workaround |
|---|---|---|
| TS SDK exposes `SubscriptionBuilder.fromSlot()` and `CommitmentLevel` from `@triton-one/yellowstone-grpc` | Gapless reconnect is one call | `worker/src/sources/grpc.ts` |
| Yellowstone delivers raw bytes; decoders written for `getTransaction` JSON need a shim | Two code paths to keep equal | `yellowstoneToRawTx` + a test that both paths decode identical events on real fixtures |
| `client.beam()` takes a `VersionedTransaction` | Launch txs must be v0 | `buildLaunchTx` compiles a v0 message |
| Blur's DEX list doesn't name Meteora DBC | Can't rely on decoded trade feeds for DBC | Decode ourselves from the gRPC stream |

## Keyless fallback (documented, used during development)
Without a Solami token the worker discovers launches from the public `logsSubscribe` stream (≈35 DBC tx/s, ≈2–5 launches/min)
and reads each window from confirmed signatures of the pool account. Public endpoints rate-limit `getTransaction`;
spreading requests over two endpoints with per-endpoint backoff kept retries invisible.
