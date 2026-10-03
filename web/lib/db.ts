import "server-only";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://curvebook:curvebook@localhost:5433/curvebook";
const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);

// One pool per server process; dev hot reload would otherwise leak connections.
const g = globalThis as unknown as { __cbSql?: postgres.Sql };
export const sql =
  g.__cbSql ??
  (g.__cbSql = postgres(url, {
    ssl: local ? false : "require",
    max: 5,
    idle_timeout: 20,
    types: { bigint: postgres.BigInt },
  }));

/** Rows to plain JSON: int8 → number (slots and counts fit), Date → ISO. numeric stays a string. */
export function plain<T>(v: unknown): T {
  return JSON.parse(
    JSON.stringify(v, function (this: any, key, val) {
      const raw = this[key];
      if (typeof raw === "bigint") return Number(raw);
      if (raw instanceof Date) return raw.toISOString();
      return val;
    }),
  ) as T;
}
