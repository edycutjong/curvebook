# DX report — Meteora DBC SDK, Solami, RPC Fast

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
| (2026-10-04, live key, SDK 0.1.56) A Free-plan `subscribe` fails with `1 CANCELLED: Call cancelled`; the real reason is only in the trailing metadata: `grpc-status 7`, *"gRPC streaming requires a plan that includes gRPC access…"* (an invalid key gives `16 invalid api key` the same way) | Looks like a network bug, not a plan limit; unary `getVersion`/`getSlot` succeed even with a bad key, so they can't be used as an auth check | Log the stream's `metadata` event; surface `grpc-message` |
| `withSwqos(key)` base58-decodes the key and uses 32 bytes as the QUIC identity seed; a dashboard "API key" is not base58 and fails with `Non-base58 character` | The "one scoped key" type doesn't work for Beam from the TS SDK | Create a dedicated SwQoS key |

## RPC Fast (the live deployment since 8 Oct 2026)
| Finding | Impact | Workaround |
|---|---|---|
| Standard Yellowstone gRPC: `@triton-one/yellowstone-grpc` connects with the endpoint and `x-token`, no vendor SDK | The gRPC source is provider-neutral (`GRPC_URL` / `GRPC_TOKEN`) | `worker/src/sources/grpc.ts` |
| JSON-RPC authenticates with an `x-token` **header**; without it every call is HTTP 401 | A URL-only RPC client can't use it | `Rpc` sends the header to the provider's endpoints only (`worker/src/rpc.ts`) |
| A bad or expired key is `7 PERMISSION_DENIED` with `{"allowed":false,"reason":"unknown_token"}`, not `16 UNAUTHENTICATED` | Treating only 16 as an auth failure would retry forever | Both 7 and 16 count; after 3 in a row the worker falls back to keyless (verified against the live endpoint with a dummy key) |
| One filtered stream carries all DBC traffic (≈10 successful DBC tx/s) | Well inside the 25-stream plan limit; stream data is not billed per message | One subscription |

## Keyless mode (fallback; the live deployment until 8 Oct 2026)
Without a gRPC endpoint the worker discovers launches from the public `logsSubscribe` stream (≈35 DBC tx/s, ≈2–5 launches/min)
and reads each window from confirmed signatures of the pool account. Public endpoints rate-limit `getTransaction`;
spreading requests over two endpoints with per-endpoint backoff kept retries invisible.
