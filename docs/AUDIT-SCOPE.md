# Audit scope — curvebook_router

| | |
|---|---|
| Program | `curvebook_router` (Anchor 0.31.1, Rust) |
| Program id | `4bjaHzaDTYxKiJ7fTMWTyMbHkQtG8t1rc8nNcHHk4iKd` |
| Source | `program/programs/curvebook_router/src/` — 10 files, 766 lines incl. ~120 lines of unit tests |
| External program invoked | Meteora Dynamic Bonding Curve `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` (IDL 0.2.1), SPL Token / Token-2022 |
| Deployment | **devnet**: [`4bjaHz…`](https://solscan.io/account/4bjaHzaDTYxKiJ7fTMWTyMbHkQtG8t1rc8nNcHHk4iKd?cluster=devnet), full claim + split path exercised there (DEMO.md §3b). Mainnet: not yet (≈ 1.6 SOL refundable rent) |
| Upgrade authority | single key during the hackathon; multisig is on the roadmap below |

## What it holds
Each Curvebook preset is a DBC config whose `fee_claimer` is the router's vault PDA `["vault", config]`.
The partner share of every launch's pool-creation fee (90%) and of every trade's fee on that config accrues
in DBC under that PDA. Anyone may crank a claim; the router pulls the fee out of DBC and splits it between
the preset author and a treasury **in the same instruction**, so the vault holds nothing between transactions.

## Instructions
| ix | signer | effect |
|---|---|---|
| `register_preset(author_bps, treasury)` | author **and** the DBC config keypair | checks the config is owned by DBC, has the PoolConfig discriminator, `fee_claimer == vault PDA`, `collect_fee_mode == QuoteToken`; creates `Preset` |
| `claim_trading_split(max_quote)` | anyone | CPI `claim_trading_fee(0, max_quote)` signed by the vault → splits the quote delta to author / treasury token accounts; emits `RoyaltySplit` |
| `claim_creation_split()` | anyone | CPI `claim_partner_pool_creation_fee` (fee receiver = vault) → splits the lamport delta; emits `RoyaltySplit` |
| `set_split(author_bps)` | author | changes the split for future claims only |

## Invariants (each has a test)
| | Invariant | Tests |
|---|---|---|
| I1 | Value leaving the vault in a claim equals value received from DBC in the same instruction; donations to the vault are never swept | `claim_creation_split pays out exactly…`, `I1: wSOL donated straight to the vault…` |
| I2 | `author + treasury == claimed` exactly; rounding remainder to treasury | Rust: `i2_*` incl. a 100k-case sweep and 0 / 1 / u64::MAX / bps 0 and 9000 |
| I3 | A preset exists only for a DBC config whose fee claimer is that preset's vault | four negative tests (wrong claimer, base-token fee mode, non-DBC owner, config not signing) |
| I4 | Only DBC is invoked; the pool's `config` must equal the preset's config | wrong-pool tests on both claims, substituted program id |
| I5 | `author_bps ≤ 9000`; only the author may change it; changes apply to future claims only | register / set_split rejections, ratio-change test |
| I6 | After `claim_trading_split`, DBC's partner unclaimed quote fee falls by exactly `RoyaltySplit.claimed` | localnet test + `scripts/rehearse-localnet.ts` |

Run: `cd program && pnpm install && pnpm test` (dumps DBC + Metaplex from mainnet, `cargo test`, `anchor test`).

## Design decisions an auditor should check
- **Config keypair co-signs `register_preset`.** The vault address is derivable from the config address, so without this anyone could register a fresh config before its creator and take the author slot.
- **Hand-written CPI** (`src/dbc.rs`) instead of `declare_program!` (the macro does not compile against this IDL's zero-copy types). Discriminators are asserted against Anchor's hash in a unit test; account order follows IDL 0.2.1. A DBC upgrade that changes the account list makes the CPI fail closed — fees stay in DBC.
- **Raw offsets** read from DBC accounts (config: `quote_mint` @8, `fee_claimer` @40, `collect_fee_mode` @232; pool: `config` @72, `partner_quote_fee` @272) are tested against the SDK decoder on localnet and against a live mainnet config.
- **Only the measured delta is split** (balance before/after the CPI), never the vault's whole balance.
- Lamport recipients must already be rent-exempt; token recipients' accounts are created idempotently by the crank first (`core/src/router.ts → claimTradingSplitIxs`).
- Transfer-hook DBC pools are not supported by the claims.

## Residual risks
- Malicious crank passes a pool from another config → rejected (I4); DBC also rejects a fee-claimer mismatch.
- Author key loss → royalties keep flowing to the lost author's account; there is no admin recovery, by design.
- Single-key upgrade authority (hackathon). A compromised key could replace the program; fees already split are unaffected.

## Roadmap (6–12 months)
1. Mainnet deploy, verifiable build (`anchor build --verifiable`), upgrade authority to a Squads multisig.
2. Third-party preset authors (onboarded by hand first), then a permissionless preset registry.
3. Read SDK `@curvebook/sdk` for launchpads: Form data + `buildLaunchTx` over HTTP.
4. Transfer-hook pool support in both claims.
5. External audit before any preset accrues more than a few hundred SOL in fees.
