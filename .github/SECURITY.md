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
`postcss` and `toml` are pinned to patched versions through `pnpm.overrides`.
