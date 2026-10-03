# Contributing

Thanks for your interest in improving Curvebook.

## Getting started
1. Fork and branch from `main`: `git checkout -b feat/your-change`
2. `pnpm install`
3. `cp .env.example .env` (every value is optional for local work)
4. `docker compose up -d db && pnpm worker` — indexes live mainnet launches keylessly
5. `pnpm web` — http://localhost:3000

On-chain work: `cd program && pnpm install && pnpm test` (runs against the real DBC program dumped from mainnet).

## Before you open a PR
- `pnpm typecheck && pnpm test` pass; `pnpm --filter @curvebook/web lint` and `e2e` pass.
- Changes to the metric (`core/src/window.ts`, `core/src/stats.ts`) need a property test and an updated `/about` page.
- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`) — releases are cut from them.

## Reporting bugs
Open an issue with the template. A wrong SNP10 report is most useful with the pool address and the signature you believe was miscounted.
