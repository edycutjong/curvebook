# Security Policy

## Supported versions
| Version | Supported |
|---|---|
| latest (`main`) | ✅ |

## Scope
- `program/` — `curvebook_router`, which holds preset fee claims (see `docs/AUDIT-SCOPE.md` for invariants I1–I6).
- `worker/` — the `/beam` landing endpoint. It only lands transactions whose message it issued (tested in `worker/test/boundaries.test.ts`).

## Reporting a vulnerability
Please **do not** open a public issue. Report privately:
- Email **edy.cu@live.com**, or
- GitHub [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) (Security → Report a vulnerability).

You'll get an acknowledgment within 48 hours and a resolution timeline after triage.

## Known dependency advisories (no upstream fix)
| Package | Path | Why it is not reachable here |
|---|---|---|
| `bigint-buffer` ≤1.1.5 | `@solana/spl-token` → `buffer-layout-utils` | Used to encode fixed-size u64 fields we construct ourselves; no untrusted buffer of attacker-chosen length reaches `toBigIntLE` |
| `braces` | wallet-adapter → `@solana-mobile` → `react-native` tooling | Build-time file globbing of the React Native toolchain; not executed in the web bundle or the worker |
| `extract-zip` ≤2.0.1 | Playwright / Lighthouse browser download (dev only) | Extracts archives from the browser vendor's CDN in CI, never user input |
| `rand` 0.7.3 (Rust) | `solana-program` → `libsecp256k1` | The advisory needs a custom logger calling `rand::rng()`; neither exists in this program |
| `braces` ≤3.0.3 | wallet-adapter-react → `@solana-mobile/*` → `react-native` → `metro` → `micromatch` | React Native's Metro bundler, pulled in as a mobile-wallet peer; it never runs in the web build or the worker, and no pattern we pass reaches it |

`postcss`, `toml`, `uuid`, `stream-json`, `tmp`, `basic-ftp` and `serialize-javascript` are pinned to patched versions through
`pnpm.overrides` (root and `program/`); vitest is on 4.1.11 (path-traversal fix). Verified after pinning: 653 unit tests at 100%
coverage, 27 program tests, and the full-stack localnet launch.
