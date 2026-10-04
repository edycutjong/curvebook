import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factory (itself hoisted above imports) can close over it.
const postgresMock = vi.hoisted(() => {
  const fn = vi.fn((url: string, opts: unknown) => ({ __fakeSql: true, url, opts }));
  (fn as unknown as { BigInt: string }).BigInt = "BIGINT_MARKER";
  return fn;
});

vi.mock("postgres", () => ({ default: postgresMock }));

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

beforeEach(() => {
  postgresMock.mockClear();
  delete (globalThis as unknown as { __cbSql?: unknown }).__cbSql;
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  delete (globalThis as unknown as { __cbSql?: unknown }).__cbSql;
});

describe("sql client construction", () => {
  it("falls back to the local default DATABASE_URL and disables ssl", async () => {
    delete process.env.DATABASE_URL;
    const { sql } = await import("@/lib/db");
    expect(postgresMock).toHaveBeenCalledTimes(1);
    const [url, opts] = postgresMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe("postgres://curvebook:curvebook@localhost:5433/curvebook");
    expect(opts.ssl).toBe(false);
    expect(opts.max).toBe(5);
    expect(opts.idle_timeout).toBe(20);
    expect((opts.types as { bigint: unknown }).bigint).toBe("BIGINT_MARKER");
    expect(sql).toEqual({ __fakeSql: true, url, opts });
  });

  it.each([
    ["postgres://u:p@localhost:5433/db", "host:port form"],
    ["postgres://u:p@localhost/db", "host/path form, no port"],
    ["postgres://u:p@127.0.0.1:5432/db", "IPv4 loopback"],
    ["postgres://u:p@[::1]:5432/db", "IPv6 loopback"],
  ])("treats %s as local (%s) and disables ssl", async (dbUrl) => {
    process.env.DATABASE_URL = dbUrl;
    await import("@/lib/db");
    const [, opts] = postgresMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts.ssl).toBe(false);
  });

  it("requires ssl for a non-local DATABASE_URL host", async () => {
    process.env.DATABASE_URL = "postgres://u:p@db.example.com:5432/curvebook";
    await import("@/lib/db");
    const [, opts] = postgresMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts.ssl).toBe("require");
  });

  it("does not treat a host that merely starts with 'localhost' as local", async () => {
    process.env.DATABASE_URL = "postgres://u:p@localhost.evil.example:5432/db";
    await import("@/lib/db");
    const [, opts] = postgresMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts.ssl).toBe("require");
  });

  it("creates exactly one client and reuses it across module reloads via globalThis (dev hot reload)", async () => {
    delete process.env.DATABASE_URL;
    const first = await import("@/lib/db");
    expect(postgresMock).toHaveBeenCalledTimes(1);
    const globalInstance = (globalThis as unknown as { __cbSql?: unknown }).__cbSql;
    expect(first.sql).toBe(globalInstance);

    // Simulate a hot-reload re-evaluation of the module without clearing globalThis.
    postgresMock.mockClear();
    vi.resetModules();
    const second = await import("@/lib/db");

    expect(postgresMock).not.toHaveBeenCalled();
    expect(second.sql).toBe(globalInstance);
    expect(second.sql).toBe(first.sql);
  });
});

describe("plain", () => {
  it("converts a bigint field to a number", async () => {
    const { plain } = await import("@/lib/db");
    expect(plain<{ a: number }>({ a: 5n })).toEqual({ a: 5 });
  });

  it("converts a Date field to an ISO string", async () => {
    const { plain } = await import("@/lib/db");
    const d = new Date("2026-01-02T03:04:05.000Z");
    expect(plain<{ when: string }>({ when: d })).toEqual({ when: "2026-01-02T03:04:05.000Z" });
  });

  it("leaves a numeric string untouched", async () => {
    const { plain } = await import("@/lib/db");
    expect(plain<{ n: string }>({ n: "0.05" })).toEqual({ n: "0.05" });
  });

  it("preserves null values", async () => {
    const { plain } = await import("@/lib/db");
    expect(plain<{ x: null }>({ x: null })).toEqual({ x: null });
  });

  it("recurses through arrays of rows, converting nested bigint and Date fields", async () => {
    const { plain } = await import("@/lib/db");
    const rows = [
      { a: 1n, when: new Date("2026-01-01T00:00:00.000Z") },
      { a: 2n, when: null },
    ];
    expect(plain<unknown>(rows)).toEqual([
      { a: 1, when: "2026-01-01T00:00:00.000Z" },
      { a: 2, when: null },
    ]);
  });

  it("converts a top-level bigint primitive", async () => {
    const { plain } = await import("@/lib/db");
    expect(plain<number>(10n)).toBe(10);
  });

  it("converts a top-level Date primitive", async () => {
    const { plain } = await import("@/lib/db");
    const d = new Date("2026-05-06T00:00:00.000Z");
    expect(plain<string>(d)).toBe("2026-05-06T00:00:00.000Z");
  });
});
