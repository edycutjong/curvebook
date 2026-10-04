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
| Worst window | **90.7%**: pool [`BZRdad…W2Gf`](https://solscan.io/account/BZRdadeK8G3ScYeoPCKReXPNgrxQ48qPysK3jSPmW2Gf), [create tx](https://solscan.io/tx/5geVVHpQ79bTT2e1FVN2X9t6jggfG1nPagVNjSFPcPa1M7KZ3Lr2Fzcs8Wi2BjeShb3ScBfunfKxMnDHspjzs5YH). One wallet bought it in slot 0 for 9.208 SOL ([tx](https://solscan.io/tx/2xwpzmLa2fPScTxXoAetw6sw5XKRfYchrLbJvQkvnC19Y5toWm9GhvHgxNrWL35zJEj2zeV1EKfuhr9gQUiDSbCt)). A second pool on the same config, [`HUjBHy…Vjen`](https://solscan.io/account/HUjBHy2J5KcMuBsPdMX4LZvP2s7NbDR5sshZYF1cjVen), shows the same 90.7%. Their config's readout: "Flat 0.25% fee from the first slot. No anti-sniper schedule." |
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
… (20 rows)
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
- `curvebook_router` and the three presets: the deploy script is `scripts/deploy-presets.ts`. It needs ≈ 2.5 SOL (program rent ≈ 1.6 SOL).
- Solami gRPC + Beam: wired (`worker/src/sources/grpc.ts`, `worker/src/lander.ts`) and switched on by `SOLAMI_RPC_TOKEN` / `SOLAMI_SWQOS_KEY`.
  The gRPC decoder is tested to produce exactly the events `getTransaction` produces on real mainnet fixtures.
