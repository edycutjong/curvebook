# DEMO — receipts and how to reproduce them

Everything below came from a real run. Mainnet numbers come from the live index; localnet numbers come from the real Meteora DBC
binary dumped from mainnet and run on a local validator. Each section says which it is.

## 1. Live mainnet index (keyless, first capture run — 2026-10-04)

```bash
pnpm install
docker compose up -d db        # Postgres on :5433
pnpm worker                    # no keys: public logsSubscribe + confirmed-signature crawl
pnpm web                       # http://localhost:3000
```

First ~30 minutes of capture, slots 453,070,248 → 453,074,746 (4,498 slots):

| | |
|---|---|
| DBC launches indexed | 78 pools across 39 configs |
| Windows finalized from confirmed signatures | 75 complete · 0 incomplete |
| Windows where outside wallets bought in slots 0–9 | 46 of 75 |
| Mean SNP10 | 8.0% of the curve's sellable supply |
| Worst window | **90.7%**: pool [`BZRdad…W2Gf`] (created in slot 453,073,301)(https://solscan.io/account/BZRdadeK8G3ScYeoPCKReXPNgrxQ48qPysK3jSPmW2Gf), [create tx](https://solscan.io/tx/5geVVHpQ79bTT2e1FVN2X9t6jggfG1nPagVNjSFPcPa1M7KZ3Lr2Fzcs8Wi2BjeShb3ScBfunfKxMnDHspjzs5YH). One wallet bought it in slot 0 for 9.208 SOL ([tx](https://solscan.io/tx/2xwpzmLa2fPScTxXoAetw6sw5XKRfYchrLbJvQkvnC19Y5toWm9GhvHgxNrWL35zJEj2zeV1EKfuhr9gQUiDSbCt)). A second pool on the same config, [`HUjBHy…Vjen`](https://solscan.io/account/HUjBHy2J5KcMuBsPdMX4LZvP2s7NbDR5sshZYF1cjVen), shows the same 90.7%. Their config's readout: "Flat 0.25% fee from the first slot. No anti-sniper schedule." |
| RPC retries | 1, absorbed (two keyless endpoints with per-endpoint backoff) |

Every buy in that window (from the committed snapshot; share = base bought ÷ the config's `swap_base_amount`):

| Slot | Wallet | In | Of curve |
|---|---|---|---|
| +0 | `61VF…B82L` | 9.208 SOL | 90.6% |
| +2 | `FheT…ecQF` | 0.004 SOL | 0.02% |
| +2 | `AKof…MzsY` | 0.01 SOL | 0.05% |
| +6 | `BotV…dBot` | 0.001 SOL | <0.01% |
| +8 | `7CHA…Jc9f` | 0.0103 SOL | 0.05% |
| +8 | `FGDc…hSLv` | 0.005 SOL | 0.02% |

"Outside" means *not the creator's signing key*. A wallet the creator funded counts as outside: SNP10 measures what left the creator's
hands in the first ten slots, not intent. No config had 20 windows from 5 creators yet, so nothing was ranked; the Form says so.

## 2. `pnpm proof` — the number chain

```bash
pnpm proof    # snapshot → offline recompute → 20 buys re-fetched from mainnet
```

Output on snapshot `fixtures/snapshot-453074621.json.gz` (sha256 `a44401839a76065c…`):

```
recompute …, slots 453070248–453074621, offline
  73 windows re-derived from 338 buys: all match
  37 configs, 0 eligible (≥20 complete windows, ≥5 creators)
most-used config 3mDSxat7hMmhQ41wQEyJJdufhN7j2Kd6oeNWEn8jfZF2: 9 launches, SNP10 p50 0.20% (not yet eligible)
live config_stats vs recomputed (same launch count): identical
✓ 5PdiqvAJKPuenGKH3CnN…  slot 453074360 (+7)  payer 9uxArNWi…  outside
✓ xfnWhhjvSkyUKun7e4YS…  slot 453074353 (+0)  payer 29hDcch4…  outside
✓ 2vtcHo4NRZ2ASbhugm1n…  slot 453073858 (+0)  payer 61VFto2W…  outside
✓ vHv66ovaxCUGgJLqKrYm…  slot 453074617 (+2)  payer GtwFoH8C…  outside
✓ 5CWCB9833jnPf87dNMVf…  slot 453072509 (+3)  payer ANz4PP7R…  outside
✓ 4fn2xno2Gd6LhnwfdxAe…  slot 453072451 (+5)  payer 9uxArNWi…  outside
✓ 5kdk3tvPiH4PU4wVeYB8…  slot 453071882 (+3)  payer BotVz5i1…  outside
✓ 3ZZRNQvozgT4GGSdGqeM…  slot 453072510 (+4)  payer 634KVScq…  outside
✓ 2qwdUxHPhQB1Gend3bf1…  slot 453073978 (+2)  payer HsEZ3hvk…  outside
✓ WCTDTBHgfiSSqC3CLX29…  slot 453072659 (+6)  payer 2GwUHPy8…  outside
✓ t85dAy6pVD5MAkdQeCki…  slot 453071052 (+2)  payer 9HWkQCx7…  outside
✓ 5WzzjEfWHEEQBrMzXPBU…  slot 453073157 (+5)  payer BotVz5i1…  outside
✓ 57gYB9jc6HqPN2hPWzsx…  slot 453072656 (+3)  payer 23vyrUNC…  outside
✓ XjpykuzBvdzJMJmGinxV…  slot 453071410 (+3)  payer BFNonoEf…  outside
✓ 2xwpzmLa2fPScTxXoAet…  slot 453073301 (+0)  payer 61VFto2W…  outside
✓ 2viRMyiLAThLHfDXjTBj…  slot 453073551 (+0)  payer EhHcrM3q…  creator
✓ D6YyEngTQWUP3sNiLPjd…  slot 453072450 (+4)  payer BsCFZbKV…  outside
✓ 4FPzQEhRu7HT2mfkvuxD…  slot 453073200 (+7)  payer BsCFZbKV…  outside
✓ WFY6ZMTUBE2vybWa7HQ6…  slot 453073077 (+4)  payer BotVz5i1…  outside
✓ 2Z3fXzdAohQZVQ9RC5sB…  slot 453074360 (+7)  payer 8TLbwpWy…  outside

20/20 match (sample seeded by snapshot sha256 a44401839a76065c…)
```

In that snapshot: **73 launch windows, 45 with outside buys in slots 0–9, 7 where outside wallets took at least 10% of the curve** (recompute with `scripts/recompute.ts`; the per-window values are in the snapshot).

The sample is chosen by the snapshot hash, so anyone re-running `scripts/verify_sample.ts` on the committed snapshot checks the same 20
buys against mainnet: slot, payer (paired through the parent swap instruction) and base amount.

## 3. Localnet rehearsal against the real DBC program

```bash
bash scripts/localnet.sh       # solana-test-validator + DBC + Metaplex (dumped from mainnet) + curvebook_router
pnpm rehearse                  # writes fixtures/rehearsal-localnet.json
```

Three presets deployed (`create_config` with fee claimer = router vault, then `register_preset`), a launch on each of two with
`buildLaunchTx`, and the same outside buys (1 SOL in slot +2 and in slot +9) on both:

| | Slow Cliff | Control |
|---|---|---|
| Creator's bundled first buy fee | 100 bps (min fee) | 100 bps |
| Outside buy, slot +2 | **3,381 bps** (formula predicts 3,382) | 100 bps |
| Outside buy, slot +9 | 860 bps | 100 bps |
| SNP10 for the same buys | 6.01% | 8.58% |
| Partner trading fees → router | 0.341 SOL | 0.0176 SOL |
| S8: Σ decoded fees vs `getPoolFeeBreakdown` | equal | equal |
| I6: unclaimed partner fee drop = split | holds | holds |
| Creation fee split (70/30) | 0.0315 / 0.0135 SOL | 0.0315 / 0.0135 SOL |

## 3b. The router on a public network (devnet)

`curvebook_router` is deployed on devnet ([program](https://solscan.io/account/4bjaHzaDTYxKiJ7fTMWTyMbHkQtG8t1rc8nNcHHk4iKd?cluster=devnet), [deploy tx](https://solscan.io/tx/5QME1KwTbEmWA6YTzFyhwqggNw8LsbXJuJ1QgiQnS6ArzM8gPxMWv9SjdzhkTDLPgPZK6sphFqAJXHDLhNiZdf1o?cluster=devnet)), byte-identical to the binary the 27 program tests ran against.
The full royalty path on the Slow Cliff preset ([config](https://solscan.io/account/FvpfixiJ8hfyGxT4Goaww88uG1HJozahPefpD2gQrNfQ?cluster=devnet), [pool](https://solscan.io/account/B84b2oHAAsF8DCqdNhmagV4XESZS6kimSy552ZBEnZ5f?cluster=devnet)), every step an explorer link:

| Step | Tx | Result |
|---|---|---|
| `create_config` (fee claimer = router vault) | [2BZZX3…](https://solscan.io/tx/2BZZX3vBCLNDe9m3xBjDysw4c56yVKkuXxbKgPaZMsNta2YSC49taiFoopYncJHb1iHf9CwyoPdYipUkYZMF4jNC?cluster=devnet) | |
| `register_preset` | [4MEJSx…](https://solscan.io/tx/4MEJSxrYkahAjPucQqcKnAbWbdDMnetp2ZkaURN6FfNrnZpVDBBaNQwkeLd6gh6c1s1SPxqPeY1BE99MDQLkQxLS?cluster=devnet) | |
| Launch (`createPoolWithFirstBuy`) | [3step6…](https://solscan.io/tx/3step6BPMf1geyrZT13yUgGh5crTBzZ87XYRC3FrM54a97Lwty8DQq8oDLviiDSPCH6cajDnWbzvKBXPDLzGy1zD?cluster=devnet) | creator's bundled buy paid 100 bps |
| Outside buy, slot +5 | [3ZzQQ2…](https://solscan.io/tx/3ZzQQ2Yv45m1MDMs3AU6WsoCfu18TEEtT9Pj53zsrrYWy1CwoV9rPiLFV7jvB4BFVUtFXjVxQs74zwT9yZPDEmKz?cluster=devnet) | paid **1,880 bps** |
| `claim_creation_split` → CPI `claim_partner_pool_creation_fee` | [ba7s2o…](https://solscan.io/tx/ba7s2oq6XsjLBw5bqac3q99R2n538wWS43wEfzhT35P9HgnFvYz5YUy3e61L1XWuyHQ31Lq8Ger5yworj59nxQE?cluster=devnet) | 0.0315 SOL author · 0.0135 SOL treasury |
| `claim_trading_split` → CPI `claim_trading_fee` | [2yiYX6…](https://solscan.io/tx/2yiYX6TiC9e8JiP7MMPZnAT8d5jA53g97TgupqmFswtcoTsHxASjxULJG7sA5kHzJ35Qo47QpFFyxwL7b12UuCAA?cluster=devnet) | 28,857,472 author · 12,367,488 treasury (wSOL atoms); I6 holds |

S8 on devnet: Σ decoded partner fees = `getPoolFeeBreakdown().partner.totalQuoteFee` = 41,224,960 exactly. Receipt: `fixtures/rehearsal-devnet.json`.

## 4. Full-stack launch (localnet)

```bash
WEB=http://localhost:3001 npx tsx scripts/e2e-launch.ts
```
```
· built: pool DYWqLXZZ…, expected 6580399511637 base atoms
· relay guard refused a transaction it did not issue (403)
· landed: 2VZqTerA… in slot 128 via rpc
· a second send of the same launch is refused (single-use)
· outside buy: 3ZV1DW58…
· receipt final: SNP10 1.40%, 2 buys, complete=true
✓ e2e launch passed
```

## 5. What is not on mainnet yet
- `curvebook_router` on mainnet: it runs on devnet (section 3b). Mainnet presets use the author's wallet as fee claimer (`CLAIMER=wallet`, ≈ 0.03 SOL for three configs); moving the router to mainnet needs ≈ 1.6 SOL of refundable program rent.
- Solami gRPC + Beam: wired (`worker/src/sources/grpc.ts`, `worker/src/lander.ts`) and switched on by `SOLAMI_RPC_TOKEN` / `SOLAMI_SWQOS_KEY`.
  The gRPC decoder is tested to produce exactly the events `getTransaction` produces on real mainnet fixtures.
