import { describe, expect, it, vi } from "vitest";
import { isTransient, retrying } from "@/lib/retry";

const err = (code: string) => Object.assign(new Error(code), { code });
const fast = { sleep: vi.fn(async () => {}), random: () => 0.5 };

describe("retrying()", () => {
  it("returns the first success without sleeping", async () => {
    const sleep = vi.fn(async () => {});
    const f = retrying(async (x: number) => x * 2, { sleep });
    expect(await f(21)).toBe(42);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries 53300 (too many clients) with doubling, jittered waits, then succeeds", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    let n = 0;
    const f = retrying(async () => { if (++n < 3) throw err("53300"); return "ok"; }, { sleep, random: () => 0.5 });
    expect(await f()).toBe("ok");
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([250, 500]);
  });

  it("gives up after `attempts` and rethrows the last transient error", async () => {
    const fn = vi.fn(async () => { throw err("CONNECTION_CLOSED"); });
    await expect(retrying(fn, { ...fast, attempts: 3 })()).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("never retries a non-transient error (e.g. a SQL syntax error)", async () => {
    const fn = vi.fn(async () => { throw err("42601"); });
    await expect(retrying(fn, fast)()).rejects.toMatchObject({ code: "42601" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("uses real timers by default", async () => {
    vi.useFakeTimers();
    let n = 0;
    const p = retrying(async () => { if (++n < 2) throw err("57P05"); return n; }, { random: () => 0 })();
    await vi.advanceTimersByTimeAsync(125);
    expect(await p).toBe(2);
    vi.useRealTimers();
  });
});

describe("isTransient()", () => {
  it.each(["53300", "57P01", "57P05", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "ECONNRESET"])("%s is transient", (c) => {
    expect(isTransient(err(c))).toBe(true);
  });
  it("other codes, missing codes and non-objects are not", () => {
    expect(isTransient(err("23505"))).toBe(false);
    expect(isTransient(new Error("x"))).toBe(false);
    expect(isTransient(null)).toBe(false);
    expect(isTransient("53300")).toBe(false);
  });
});
