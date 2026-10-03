// Launch request validation. Pure; messages are shown to the creator verbatim.
export type LaunchInput = { preset: string; wallet: string; name: string; symbol: string; uri: string; buySol: number };

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function validateLaunch(body: unknown): { ok: true; value: LaunchInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "send a JSON body" };
  const b = body as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  const preset = str("preset");
  const wallet = str("wallet");
  const name = str("name");
  const symbol = str("symbol");
  const uri = str("uri");
  const buySol = typeof b.buySol === "number" ? b.buySol : Number(b.buySol);

  if (!preset) return { ok: false, error: "choose a preset" };
  if (!BASE58.test(wallet)) return { ok: false, error: "connect a wallet first" };
  if (!name || name.length > 32) return { ok: false, error: "name must be 1 to 32 characters" };
  if (!symbol || symbol.length > 10) return { ok: false, error: "symbol must be 1 to 10 characters" };
  if (uri.length > 200) return { ok: false, error: "metadata URI must be at most 200 characters" };
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return { ok: false, error: "metadata URI must be a full https:// URL" };
  }
  if (url.protocol !== "https:") return { ok: false, error: "metadata URI must use https" };
  if (!Number.isFinite(buySol) || buySol <= 0 || buySol > 5) return { ok: false, error: "first buy must be more than 0 and at most 5 SOL" };
  return { ok: true, value: { preset, wallet, name, symbol, uri, buySol } };
}

/** SOL (as typed) to lamports without float drift beyond 9 decimals. */
export function solToLamports(buySol: number): bigint {
  const [whole, frac = ""] = buySol.toFixed(9).split(".");
  return BigInt(whole) * 1_000_000_000n + BigInt(frac.padEnd(9, "0").slice(0, 9));
}
