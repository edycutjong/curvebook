import "server-only";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://curvebook:curvebook@localhost:5433/curvebook";
const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);

// One pool per server process; dev hot reload would otherwise leak connections.
// On Vercel every function instance holds its own pool, and a frozen instance never runs its
// client-side idle timer, so its connections sat idle for minutes (89 of Postgres's 100 on
// 2026-10-09) and a burst of page loads failed with 53300 "too many clients". Keep pools small,
// and have the server end any web connection idle for 30 s (idle_session_timeout is per session:
// the worker's long-lived advisory-lock connection is not affected).
const g = globalThis as unknown as { __cbSql?: postgres.Sql };
export const sql =
  g.__cbSql ??
  (g.__cbSql = postgres(url, {
    ssl: local ? false : "require",
    max: 2,
    idle_timeout: 5,
    max_lifetime: 300,
    connection: { idle_session_timeout: 30_000 },
    types: { bigint: postgres.BigInt },
  }));

/** Rows to plain JSON: int8 → number (slots and counts fit), Date → ISO. numeric stays a string. */
export function plain<T>(v: unknown): T {
  return JSON.parse(
    JSON.stringify(v, function (this: Record<string, unknown>, key, val) {
      const raw = this[key];
      if (typeof raw === "bigint") return Number(raw);
      if (raw instanceof Date) return raw.toISOString();
      return val;
    }),
  ) as T;
}
