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

describe("validateLaunch - coverage gaps", () => {
  it("rejects null body", () => {
    expect(validateLaunch(null)).toEqual({ ok: false, error: "send a JSON body" });
  });

  it("rejects undefined body", () => {
    expect(validateLaunch(undefined)).toEqual({ ok: false, error: "send a JSON body" });
  });

  it("rejects string body", () => {
    expect(validateLaunch("not an object")).toEqual({ ok: false, error: "send a JSON body" });
  });

  it("rejects number body", () => {
    expect(validateLaunch(42)).toEqual({ ok: false, error: "send a JSON body" });
  });

  it("rejects array body (treats as empty object)", () => {
    // Arrays are objects in JavaScript, so they pass the object check
    // but fail at "choose a preset" since array has no property "preset"
    expect(validateLaunch([])).toEqual({ ok: false, error: "choose a preset" });
  });

  it("rejects empty preset", () => {
    expect(validateLaunch({ ...good, preset: "" })).toEqual({ ok: false, error: "choose a preset" });
  });

  it("rejects preset with only whitespace", () => {
    expect(validateLaunch({ ...good, preset: "   " })).toEqual({ ok: false, error: "choose a preset" });
  });

  it("handles non-string preset value", () => {
    expect(validateLaunch({ ...good, preset: 123 })).toEqual({ ok: false, error: "choose a preset" });
  });

  it("handles non-string wallet value", () => {
    expect(validateLaunch({ ...good, wallet: 123 })).toEqual({ ok: false, error: "connect a wallet first" });
  });

  it("handles non-string name value", () => {
    expect(validateLaunch({ ...good, name: 123 })).toEqual({ ok: false, error: "name must be 1 to 32 characters" });
  });

  it("handles non-string symbol value", () => {
    expect(validateLaunch({ ...good, symbol: 123 })).toEqual({ ok: false, error: "symbol must be 1 to 10 characters" });
  });

  it("handles non-string uri value", () => {
    expect(validateLaunch({ ...good, uri: 123 })).toEqual({ ok: false, error: "metadata URI must be a full https:// URL" });
  });

  it("rejects empty name", () => {
    expect(validateLaunch({ ...good, name: "" })).toEqual({ ok: false, error: "name must be 1 to 32 characters" });
  });

  it("rejects name with only whitespace", () => {
    expect(validateLaunch({ ...good, name: "   " })).toEqual({ ok: false, error: "name must be 1 to 32 characters" });
  });

  it("rejects name exactly 33 characters", () => {
    expect(validateLaunch({ ...good, name: "x".repeat(33) })).toEqual({ ok: false, error: "name must be 1 to 32 characters" });
  });

  it("accepts name exactly 32 characters", () => {
    const result = validateLaunch({ ...good, name: "x".repeat(32) });
    expect(result.ok).toBe(true);
  });

  it("rejects empty symbol", () => {
    expect(validateLaunch({ ...good, symbol: "" })).toEqual({ ok: false, error: "symbol must be 1 to 10 characters" });
  });

  it("rejects symbol with only whitespace", () => {
    expect(validateLaunch({ ...good, symbol: "   " })).toEqual({ ok: false, error: "symbol must be 1 to 10 characters" });
  });

  it("rejects symbol exactly 11 characters", () => {
    expect(validateLaunch({ ...good, symbol: "x".repeat(11) })).toEqual({ ok: false, error: "symbol must be 1 to 10 characters" });
  });

  it("accepts symbol exactly 10 characters", () => {
    const result = validateLaunch({ ...good, symbol: "x".repeat(10) });
    expect(result.ok).toBe(true);
  });

  it("rejects URI with length exactly 201", () => {
    const uri201 = "https://example.org/" + "x".repeat(181); // 20 + 181 = 201
    expect(validateLaunch({ ...good, uri: uri201 })).toEqual({
      ok: false,
      error: "metadata URI must be at most 200 characters",
    });
  });

  it("accepts URI with length exactly 200", () => {
    const uri200 = "https://example.org/" + "x".repeat(180); // 20 + 180 = 200
    const result = validateLaunch({ ...good, uri: uri200 });
    expect(result.ok).toBe(true);
  });

  it("rejects buySol as NaN", () => {
    expect(validateLaunch({ ...good, buySol: NaN })).toEqual({
      ok: false,
      error: "first buy must be more than 0 and at most 5 SOL",
    });
  });

  it("rejects buySol as Infinity", () => {
    expect(validateLaunch({ ...good, buySol: Infinity })).toEqual({
      ok: false,
      error: "first buy must be more than 0 and at most 5 SOL",
    });
  });

  it("rejects buySol as negative Infinity", () => {
    expect(validateLaunch({ ...good, buySol: -Infinity })).toEqual({
      ok: false,
      error: "first buy must be more than 0 and at most 5 SOL",
    });
  });

  it("rejects negative buySol", () => {
    expect(validateLaunch({ ...good, buySol: -0.5 })).toEqual({
      ok: false,
      error: "first buy must be more than 0 and at most 5 SOL",
    });
  });

  it("rejects buySol as non-numeric string that can't convert", () => {
    expect(validateLaunch({ ...good, buySol: "not a number" })).toEqual({
      ok: false,
      error: "first buy must be more than 0 and at most 5 SOL",
    });
  });

  it("accepts buySol as numeric string", () => {
    const result = validateLaunch({ ...good, buySol: "1.5" as never });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.buySol).toBe(1.5);
    }
  });

  it("accepts buySol exactly 5", () => {
    const result = validateLaunch({ ...good, buySol: 5 });
    expect(result.ok).toBe(true);
  });

  it("trims whitespace from string fields", () => {
    const result = validateLaunch({
      preset: "  slow-cliff  ",
      wallet: "  DXFqi6tXYGjavSCXEV7NHGYwsaWMqSszrx6VKcg6yUNq  ",
      name: "  Test  ",
      symbol: "  TST  ",
      uri: "https://example.org/meta.json",
      buySol: 0.1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.preset).toBe("slow-cliff");
      expect(result.value.name).toBe("Test");
      expect(result.value.symbol).toBe("TST");
    }
  });

  it("rejects empty URI (invalid URL)", () => {
    const result = validateLaunch({ ...good, uri: "" });
    expect(result.ok).toBe(false); // empty string is not a valid URL
    expect(result).toEqual({ ok: false, error: "metadata URI must be a full https:// URL" });
  });

  it("handles invalid wallet addresses", () => {
    const testCases = [
      "short",
      "0".repeat(32), // all zeros in base58
      "invalid+chars=",
      "O0Il1234567890abcdefghijklmnopqrstuvwxyz", // contains invalid base58 chars (O, 0, I, l)
    ];
    testCases.forEach((wallet) => {
      expect(validateLaunch({ ...good, wallet })).toEqual({ ok: false, error: "connect a wallet first" });
    });
  });

  it("accepts valid 32-character base58 address", () => {
    expect(validateLaunch({ ...good, wallet: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }).ok).toBe(true);
  });

  it("accepts valid 44-character base58 address", () => {
    expect(validateLaunch({ ...good, wallet: good.wallet }).ok).toBe(true);
  });
});

describe("solToLamports - coverage gaps", () => {
  it("handles small fractional SOL", () => {
    expect(solToLamports(0.000000001)).toBe(1n);
    expect(solToLamports(0.000000002)).toBe(2n);
  });

  it("handles integer SOL", () => {
    expect(solToLamports(1)).toBe(1_000_000_000n);
    expect(solToLamports(2)).toBe(2_000_000_000n);
  });

  it("handles mixed whole and fractional SOL", () => {
    expect(solToLamports(1.5)).toBe(1_500_000_000n);
    expect(solToLamports(2.123456789)).toBe(2_123_456_789n);
  });

  it("handles fractional values with fewer than 9 decimal places", () => {
    expect(solToLamports(0.5)).toBe(500_000_000n);
    expect(solToLamports(0.12)).toBe(120_000_000n);
  });

  it("handles very large SOL amounts", () => {
    expect(solToLamports(1000)).toBe(1_000_000_000_000n);
  });

  it("truncates beyond 9 decimal places", () => {
    // 1.123456789123456789 should become 1.123456789
    expect(solToLamports(1.123456789123456789)).toBe(1_123_456_789n);
  });
});
