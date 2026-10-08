# Market and unit economics — from the live index

All inputs below are measured by Curvebook's own mainnet index over its first 4.9 days of capture
(2026-10-04 01:11 → 2026-10-08 23:47 UTC). Only SOL-quoted pools are counted; pools quoted in USDC or other
tokens are excluded so amounts are never mixed across units. Scenario lines are labelled as scenarios.

## The market (measured)

| Measure | Value |
|---|---|
| SOL-quoted DBC launches | 25,630 in 4.9 days ≈ **5,200 per day** |
| Graduated so far | 16,477 (64%); 59% of all pools older than 24 h |
| Graduation threshold of graduated pools | median **10.95 SOL** (mean 7.93) |
| SOL put into slots 0–9 by wallets other than the creator | **48,264 SOL** ≈ 9,800 SOL/day ≈ 1.9 SOL per launch |
| Launches on the 4 ranked configs where outside wallets take a median > 50% | 3,774 (15% of SOL-quoted launches) |

## The customers (measured)

A DBC config names a fee claimer, normally the launchpad that runs it.

| Measure | Value |
|---|---|
| Distinct fee claimers with ≥ 1 SOL-quoted launch | 3,847 |
| with ≥ 20 launches in 4.9 days | 87 |
| with ≥ 100 launches in 4.9 days | **35** |
| Share of all launches run by the top 10 | **38%** (9,667 of 25,631) |

Ten conversations cover more than a third of DBC launch volume; the largest single launchpad runs 6.4%.

## Unit economics (lower bound)

A launchpad that runs launches on a Curvebook preset earns the DBC partner trading fee. On the presets the fee is
1% once the anti-sniper schedule ends, and the partner receives 80% of trading fees after Meteora's share (the S8
identity, verified on localnet, devnet and mainnet: DEMO.md §1b). The `curvebook_router` claims that fee and splits
it 70% preset author / 30% treasury (live on devnet, DEMO.md §3b; mainnet deploy pending).

A pool cannot graduate before at least its threshold in quote has been bought, so per graduated pool:

- partner fees ≥ 10.95 SOL × 1% × 80% = **0.088 SOL**
- treasury (30%) ≥ **0.026 SOL**; preset author (70%) ≥ 0.061 SOL

| Scenario: share of SOL-quoted launches on Curvebook presets | Graduated launches/day | Treasury, lower bound |
|---|---|---|
| 1% | ≈ 31 | ≈ 0.8 SOL/day ≈ 25 SOL/month |
| 5% | ≈ 156 | ≈ 4.1 SOL/day ≈ 123 SOL/month |
| 10% (the two largest launchpads run 11.5% today) | ≈ 312 | ≈ 8.2 SOL/day ≈ 246 SOL/month |

(5,200 launches/day × 60% graduation × share × 0.026 SOL.)

## What the lower bound leaves out

- Trading beyond the minimum: sells, and any buying past the threshold, also pay the fee. The index does not measure
  full-life volume per pool, so none of it is counted.
- Anti-sniper fees: on a preset, a slot-0 buy pays a 50% fee that goes to the partner instead of the sniper keeping
  the supply. Outside wallets put ~1.9 SOL per launch into slots 0–9 today; snipers would adapt, so none of it is counted.
- Pool creation fees (0.001 SOL on the mainnet presets) and a paid read API for launchpads and trading terminals
  (not priced yet).

## Limits

- 4.9 days is under a week of one market; DBC launch volume moves with meme-coin cycles.
- Graduation is read from the index (`graduated_at`); pools younger than 24 h may still graduate.
- A fee claimer is a proxy for a launchpad: one operator can use several claimers, and a creator can be their own.
- Adoption is the open question: no third-party launchpad runs a Curvebook preset yet (README "Status, honestly").
