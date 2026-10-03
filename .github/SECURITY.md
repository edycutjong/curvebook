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
