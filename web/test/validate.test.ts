import { describe, expect, it } from "vitest";
import { solToLamports, validateLaunch } from "@/lib/validate";

const good = {
  preset: "slow-cliff",
  wallet: "DXFqi6tXYGjavSCXEV7NHGYwsaWMqSszrx6VKcg6yUNq",
  name: "Test",
  symbol: "TST",
  uri: "https://example.org/meta.json",
  buySol: 0.1,
};

describe("validateLaunch", () => {
  it("accepts a well-formed request", () => {
    expect(validateLaunch(good)).toEqual({ ok: true, value: good });
  });

  it.each([
    [{ name: "x".repeat(33) }, "name must be 1 to 32 characters"],
    [{ symbol: "TOOLONGSYMB" }, "symbol must be 1 to 10 characters"],
    [{ uri: "http://example.org/a.json" }, "metadata URI must use https"],
    [{ uri: "not a url" }, "metadata URI must be a full https:// URL"],
    [{ buySol: 0 }, "first buy must be more than 0 and at most 5 SOL"],
    [{ buySol: 5.01 }, "first buy must be more than 0 and at most 5 SOL"],
    [{ wallet: "nope" }, "connect a wallet first"],
  ])("rejects %j", (patch, error) => {
    expect(validateLaunch({ ...good, ...patch })).toEqual({ ok: false, error });
  });

  it("converts SOL to lamports exactly", () => {
    expect(solToLamports(0.1)).toBe(100_000_000n);
    expect(solToLamports(5)).toBe(5_000_000_000n);
    expect(solToLamports(0.000000001)).toBe(1n);
  });
});
