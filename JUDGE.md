# For judges

> Curvebook measures how much of every Meteora DBC launch outside wallets buy in its first ten slots, and lets you launch on a curve by that record.

This file mirrors the `/judge` page of the running app. Figures that come from the index are not repeated here, because they change every minute. They are shown live on `/judge`.

## 30-second path

1. **The Form** at `/`: every DBC config, ranked by SNP10.
2. **A live receipt** at `/pool/<address>`: the newest finalized pool whose window has outside buys (SNP10 > 0). Live on `/judge`.
3. **The most-launched config** at `/config/<address>`: the config with the most indexed pools. Live on `/judge`.
4. **Verify** at `/integrations/verify`: the raw event feed and stream health.
5. **Method** at `/about`: SNP10, defined once and frozen.

## Receipt

From the index, live on `/judge`:

- capture start slot
- pools indexed
- windows final / incomplete
- distinct configs
- window buys recorded
- stream lag and source

Committed facts:

| | |
|---|---|
| Tests | 168 core · 223 worker · 254 web (100% line/branch coverage) · 8 Rust + 19 localnet program tests · 23 e2e; property checks over 30,000 windows and 20,000 fee schedules |
| Proof | `pnpm proof`: windows re-derived offline, 20/20 sampled buys re-fetched from mainnet match |
| Localnet rehearsal | slot+2 outside buy on Slow Cliff paid 3,381 bps vs creator 100 bps; same buys on Control paid 100 bps; partner fees decoded = SDK total (S8); creation fee split 70/30 on-chain |

## Reproduce

Keyless, against live mainnet. Index and serve:

```bash
pnpm install && docker compose up -d db && pnpm worker
pnpm web
```

Re-derive the windows and re-fetch a sample of buys from mainnet:

```bash
pnpm proof
```

CI / localnet rehearsal:

```bash
bash scripts/localnet.sh
pnpm rehearse
```

## Honest limitations

- The three presets are live on mainnet with one own launch each (DEMO.md §1b); the router that splits their fees runs on devnet (DEMO.md §3b), not yet on mainnet.
- The index covers only launches since capture start; nothing earlier is backfilled.
- Creator-funded sybil wallets count as outsiders.
- Keyless mode reads windows from public RPC; Solami gRPC is used when a token is set.

## Links

The repository, live app, demo video and pitch deck links are listed on `/judge` when they are configured (`NEXT_PUBLIC_REPO_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_VIDEO_URL`, `NEXT_PUBLIC_DECK_URL`).
