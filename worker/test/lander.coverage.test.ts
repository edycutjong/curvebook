// Drives worker/src/lander.ts to 100% coverage: every branch of land() (relay guard, simulate,
// send via RPC or Beam, poll + resend, blockhash expiry, record + index) and explainSimError.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { explainSimError, land, LandError } from "../src/lander.js";
import bs58 from "bs58";

/** A real, signed v0 transaction (self-transfer), base64-encoded the same way the API relays it,
 *  plus the bs58 signature lander.ts itself computes from those bytes (D4 resend identity). */
function signedTxBase64(): { b64: string; sig: string } {
  const payer = Keypair.generate();
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })],
    }).compileToV0Message(),
  );
  tx.sign([payer]);
  return { b64: Buffer.from(tx.serialize()).toString("base64"), sig: bs58.encode(tx.signatures[0]) };
}

type SqlCall = { text: string; values: unknown[] };

/** Fake tagged-template `sql`. Scriptable per-statement by substring match on the SQL text. */
function makeSql(opts: { issuedRows?: any[] } = {}) {
  const calls: SqlCall[] = [];
  const fn: any = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("|");
    calls.push({ text, values });
    if (text.includes("delete from issued_tx")) return Promise.resolve(opts.issuedRows ?? []);
    if (text.includes("insert into launches")) return Promise.resolve([]);
    return Promise.resolve([]);
  };
  fn.json = (v: unknown) => ({ __json: v });
  fn.calls = calls;
  return fn;
}

type RpcScript = Record<string, unknown[] | ((params: unknown[], callIndex: number) => unknown)>;

/** Fake `rpc`. `script[method]` is either an array of successive responses (clamped to the last
 *  once exhausted) or a function of (params, callIndex). */
function makeRpc(script: RpcScript, getTransaction: (sig: string) => Promise<unknown> = async () => null) {
  const calls: { method: string; params: unknown[] }[] = [];
  const counters: Record<string, number> = {};
  const rpc: any = {
    call: async (method: string, params: unknown[]) => {
      calls.push({ method, params });
      const entry = script[method];
      const idx = counters[method] ?? 0;
      counters[method] = idx + 1;
      if (typeof entry === "function") return entry(params, idx);
      if (Array.isArray(entry)) return entry[Math.min(idx, entry.length - 1)];
      throw new Error(`unscripted rpc.call(${method})`);
    },
    getTransaction,
  };
  rpc.calls = calls;
  return rpc;
}

const issuedRow = (sig: string) => ({
  pool: "PoolAddr111111111111111111111111111111111",
  preset: "default",
  wallet: "Wallet1111111111111111111111111111111111",
  base_mint: "Mint11111111111111111111111111111111111",
  last_valid_block_height: "1000",
  hash: "irrelevant-in-this-fake",
  expires_at: new Date(Date.now() + 60_000),
});

const simOk = { value: { err: null, logs: [] } };
const notLanded = { value: [{ confirmationStatus: "processed" }] };
const confirmed = (slot = 42) => ({ value: [{ confirmationStatus: "confirmed", slot }] });
const finalized = (slot = 42) => ({ value: [{ confirmationStatus: "finalized", slot }] });
const errored = (err: unknown) => ({ value: [{ err }] });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("land(): relay guard", () => {
  it("rejects with 403 before touching rpc or sql insert when no issued_tx row matches", async () => {
    const { b64 } = signedTxBase64();
    const sql = makeSql({ issuedRows: [] });
    const rpc = makeRpc({});
    const err = await land({ sql, rpc, indexer: { onTx: vi.fn(), watch: vi.fn() } as any, beam: null, ownWallets: new Set(), txBase64: b64 }).catch((e) => e);
    expect(err).toBeInstanceOf(LandError);
    expect((err as LandError).status).toBe(403);
    expect(rpc.calls).toEqual([]);
  });
});

describe("land(): simulation failure", () => {
  it("surfaces a 422 with the explained message and logs, never sends", async () => {
    const { b64, sig } = signedTxBase64();
    const sql = makeSql({ issuedRows: [issuedRow(sig)] });
    const rpc = makeRpc({ simulateTransaction: [{ value: { err: { x: 1 }, logs: ["Transfer: insufficient lamports 1, need 2"] } }] });
    const err: LandError = await land({
      sql, rpc, indexer: { onTx: vi.fn(), watch: vi.fn() } as any, beam: null, ownWallets: new Set(), txBase64: b64,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(LandError);
    expect(err.status).toBe(422);
    expect(err.message).toMatch(/enough SOL/);
    expect(err.logs).toEqual(["Transfer: insufficient lamports 1, need 2"]);
    expect(rpc.calls.some((c: any) => c.method === "sendTransaction")).toBe(false);
  });

  it("falls back to an empty logs array when the simulation response omits logs entirely", async () => {
    const { b64, sig } = signedTxBase64();
    const sql = makeSql({ issuedRows: [issuedRow(sig)] });
    const rpc = makeRpc({ simulateTransaction: [{ value: { err: { x: 1 } } }] }); // no `logs` key at all
    const err: LandError = await land({
      sql, rpc, indexer: { onTx: vi.fn(), watch: vi.fn() } as any, beam: null, ownWallets: new Set(), txBase64: b64,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(LandError);
    expect(err.status).toBe(422);
    expect(err.logs).toEqual([]);
    expect(err.message).toBe('simulation failed: {"x":1}');
  });
});

describe("land(): lands via RPC on the first poll", () => {
  it("sends via rpc.call, records the launch and indexes the fetched tx", async () => {
    const { b64, sig } = signedTxBase64();
    const row = issuedRow(sig);
    const sql = makeSql({ issuedRows: [row] });
    const onTx = vi.fn();
    const watch = vi.fn();
    const fakeTx = { slot: 42 };
    const rpc = makeRpc(
      { simulateTransaction: [simOk], sendTransaction: ["sent-sig"], getSignatureStatuses: [confirmed(42)], getBlockHeight: [1] },
      async () => fakeTx,
    );
    const result = await land({ sql, rpc, indexer: { onTx, watch } as any, beam: null, ownWallets: new Set([row.wallet]), txBase64: b64, timeoutMs: 3_000 });

    expect(result.sig).toBe(sig);
    expect(result.landedSlot).toBe(42);
    expect(result.via).toBe("rpc");
    expect(result.pool).toBe(row.pool);
    expect(rpc.calls.some((c: any) => c.method === "sendTransaction")).toBe(true);
    expect(onTx).toHaveBeenCalledWith(fakeTx);
    expect(watch).toHaveBeenCalledWith(row.pool);

    const insert = sql.calls.find((c: SqlCall) => c.text.includes("insert into launches"));
    expect(insert).toBeDefined();
    // ownWallets contains the wallet -> NOT third-party (last interpolated value).
    expect(insert!.values.at(-1)).toBe(false);
  }, 10_000);

  it("flags third_party=true when the launching wallet is not in ownWallets", async () => {
    const { b64, sig } = signedTxBase64();
    const row = issuedRow(sig);
    const sql = makeSql({ issuedRows: [row] });
    const rpc = makeRpc(
      { simulateTransaction: [simOk], sendTransaction: ["sent-sig"], getSignatureStatuses: [confirmed(7)], getBlockHeight: [1] },
      async () => null,
    );
    await land({ sql, rpc, indexer: { onTx: vi.fn(), watch: vi.fn() } as any, beam: null, ownWallets: new Set(["someone-else"]), txBase64: b64, timeoutMs: 3_000 });
    const insert = sql.calls.find((c: SqlCall) => c.text.includes("insert into launches"));
    expect(insert!.values.at(-1)).toBe(true);
  }, 10_000);

  it("skips indexer.onTx (but still watches the pool) when getTransaction comes back null", async () => {
    const { b64, sig } = signedTxBase64();
    const row = issuedRow(sig);
    const sql = makeSql({ issuedRows: [row] });
    const onTx = vi.fn();
    const watch = vi.fn();
    const rpc = makeRpc(
      { simulateTransaction: [simOk], sendTransaction: ["sent-sig"], getSignatureStatuses: [finalized(9)], getBlockHeight: [1] },
      async () => null,
    );
    await land({ sql, rpc, indexer: { onTx, watch } as any, beam: null, ownWallets: new Set(), txBase64: b64, timeoutMs: 3_000 });
    expect(onTx).not.toHaveBeenCalled();
    expect(watch).toHaveBeenCalledWith(row.pool);
  }, 10_000);
});

describe("land(): lands via Beam", () => {
  it("sends through beam() instead of rpc.call(sendTransaction), and fetches the swqos receipt (ok)", async () => {
    const { b64, sig } = signedTxBase64();
    const row = issuedRow(sig);
    const sql = makeSql({ issuedRows: [row] });
    const beamed: VersionedTransaction[] = [];
    const beam = vi.fn(async (tx: VersionedTransaction) => {
      beamed.push(tx);
      return "beam-receipt";
    });
    const rpc = makeRpc({ simulateTransaction: [simOk], getSignatureStatuses: [confirmed(5)], getBlockHeight: [1] }, async () => null);
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(`https://api.solami.dev/swqos/tx/${sig}`);
      return { ok: true, json: async () => ({ landed_at: "beam" }) } as any;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await land({ sql, rpc, indexer: { onTx: vi.fn(), watch: vi.fn() } as any, beam, ownWallets: new Set(), txBase64: b64, timeoutMs: 3_000 });

    expect(result.via).toBe("beam");
    expect(beam).toHaveBeenCalledTimes(1);
    expect(beamed[0]).toBeInstanceOf(VersionedTransaction);
    expect(rpc.calls.some((c: any) => c.method === "sendTransaction")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.swqos).toEqual({ landed_at: "beam" });

    const insert = sql.calls.find((c: SqlCall) => c.text.includes("insert into launches"));
    expect(insert!.values.some((v: any) => v && v.__json && v.__json.landed_at === "beam")).toBe(true);
  }, 10_000);

  it("swqos is null when the receipt fetch resolves not-ok", async () => {
    const { b64, sig } = signedTxBase64();
    const row = issuedRow(sig);
    const sql = makeSql({ issuedRows: [row] });
    const beam = vi.fn(async () => "beam-receipt");
    const rpc = makeRpc({ simulateTransaction: [simOk], getSignatureStatuses: [confirmed(5)], getBlockHeight: [1] }, async () => null);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ should: "not be read" }) } as any)));

    const result = await land({ sql, rpc, indexer: { onTx: vi.fn(), watch: vi.fn() } as any, beam, ownWallets: new Set(), txBase64: b64, timeoutMs: 3_000 });
    expect(result.swqos).toBeNull();
  }, 10_000);

  it("swqos is null (not thrown) when the receipt fetch itself rejects", async () => {
    const { b64, sig } = signedTxBase64();
    const row = issuedRow(sig);
    const sql = makeSql({ issuedRows: [row] });
    const beam = vi.fn(async () => "beam-receipt");
    const rpc = makeRpc({ simulateTransaction: [simOk], getSignatureStatuses: [confirmed(5)], getBlockHeight: [1] }, async () => null);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));

    const result = await land({ sql, rpc, indexer: { onTx: vi.fn(), watch: vi.fn() } as any, beam, ownWallets: new Set(), txBase64: b64, timeoutMs: 3_000 });
    expect(result.swqos).toBeNull();
  }, 10_000);
});

describe("land(): default timeout", () => {
  it("uses the 45s default deadline when timeoutMs is omitted (still lands on the first poll)", async () => {
    const { b64, sig } = signedTxBase64();
    const row = issuedRow(sig);
    const sql = makeSql({ issuedRows: [row] });
    const rpc = makeRpc(
      { simulateTransaction: [simOk], sendTransaction: ["sent-sig"], getSignatureStatuses: [confirmed(11)], getBlockHeight: [1] },
      async () => null,
    );
    const result = await land({ sql, rpc, indexer: { onTx: vi.fn(), watch: vi.fn() } as any, beam: null, ownWallets: new Set(), txBase64: b64 });
    expect(result.landedSlot).toBe(11);
  }, 10_000);
});

describe("land(): poll loop edge cases", () => {
  it("throws 422 when the signature status itself reports an on-chain error", async () => {
    const { b64, sig } = signedTxBase64();
    const row = issuedRow(sig);
    const sql = makeSql({ issuedRows: [row] });
    const rpc = makeRpc({
      simulateTransaction: [simOk], sendTransaction: ["sent-sig"],
      getSignatureStatuses: [errored({ InstructionError: [0, "Custom"] })], getBlockHeight: [1],
    });
    const err: LandError = await land({
      sql, rpc, indexer: { onTx: vi.fn(), watch: vi.fn() } as any, beam: null, ownWallets: new Set(), txBase64: b64, timeoutMs: 3_000,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(LandError);
    expect(err.status).toBe(422);
    expect(err.message).toMatch(/failed on-chain/);
  }, 10_000);

  it("resends the identical signed bytes on odd poll iterations, then lands", async () => {
    const { b64, sig } = signedTxBase64();
    const row = issuedRow(sig);
    const sql = makeSql({ issuedRows: [row] });
    const rpc = makeRpc({
      simulateTransaction: [simOk],
      sendTransaction: ["sent-1", "sent-2"],
      // not landed, not landed (resend fires after this one), landed
      getSignatureStatuses: [notLanded, notLanded, confirmed(99)],
      getBlockHeight: [1, 1, 1],
    });
    const result = await land({
      sql, rpc, indexer: { onTx: vi.fn(), watch: vi.fn() } as any, beam: null, ownWallets: new Set(), txBase64: b64, timeoutMs: 3_500,
    });
    expect(result.landedSlot).toBe(99);
    const sendCount = rpc.calls.filter((c: any) => c.method === "sendTransaction").length;
    expect(sendCount).toBe(2); // initial send + one resend at i=1
  }, 10_000);

  it("throws 410 once the chain height passes the issued transaction's last valid block height", async () => {
    const { b64, sig } = signedTxBase64();
    const row = issuedRow(sig);
    const sql = makeSql({ issuedRows: [row] });
    const rpc = makeRpc({
      simulateTransaction: [simOk], sendTransaction: ["sent-sig"],
      getSignatureStatuses: [notLanded], getBlockHeight: [Number(row.last_valid_block_height) + 1],
    });
    const err: LandError = await land({
      sql, rpc, indexer: { onTx: vi.fn(), watch: vi.fn() } as any, beam: null, ownWallets: new Set(), txBase64: b64, timeoutMs: 10_000,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(LandError);
    expect(err.status).toBe(410);
    expect(err.message).toMatch(/expired/);
  }, 10_000);

  it("throws 504 if nothing lands before the deadline", async () => {
    const { b64, sig } = signedTxBase64();
    const row = issuedRow(sig);
    const sql = makeSql({ issuedRows: [row] });
    const rpc = makeRpc({
      simulateTransaction: [simOk], sendTransaction: ["sent-sig"],
      getSignatureStatuses: [notLanded], getBlockHeight: [1],
    });
    const err: LandError = await land({
      sql, rpc, indexer: { onTx: vi.fn(), watch: vi.fn() } as any, beam: null, ownWallets: new Set(), txBase64: b64, timeoutMs: 1_500,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(LandError);
    expect(err.status).toBe(504);
    expect(err.message).toMatch(/not confirmed within the time limit/);
  }, 10_000);
});

describe("explainSimError: remaining branches", () => {
  it("names an already-used mint", () => {
    expect(explainSimError({}, ["Program log: AccountAlreadyInUse"])).toMatch(/already used/);
  });
  it("flags an expired blockhash reported in the error object, not the logs", () => {
    const err = { InstructionError: [0, { Custom: "BlockhashNotFound" }] };
    expect(explainSimError(err, [])).toMatch(/blockhash is gone/);
  });
  it("falls back to a raw dump when nothing matches", () => {
    const err = { foo: 1 };
    expect(explainSimError(err, ["some unrelated log line"])).toBe('simulation failed: {"foo":1}');
  });
});
