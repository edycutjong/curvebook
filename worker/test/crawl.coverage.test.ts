import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeTx, inWindow, type RawTx } from "@curvebook/core";
import { crawlWindow, poolSignatures, type CrawlRpc } from "../src/crawl.js";

const fx = (n: string): RawTx => JSON.parse(readFileSync(new URL(`../../core/test/fixtures/${n}.json`, import.meta.url), "utf8"));

/** A fake ledger: signatures newest-first, paged 1000 at a time like the real RPC. */
function ledger(entries: { signature: string; slot: number; err?: unknown; tx?: RawTx | null }[]): CrawlRpc & { calls: number } {
  const sorted = [...entries].sort((a, b) => b.slot - a.slot);
  return {
    calls: 0,
    async getSignaturesForAddress(_addr, opts = {}) {
      this.calls++;
      const start = opts.before ? sorted.findIndex((e) => e.signature === opts.before) + 1 : 0;
      return sorted.slice(start, start + (opts.limit ?? 1000)).map((e) => ({ signature: e.signature, slot: e.slot, err: e.err ?? null }));
    },
    async getTransaction(sig) {
      return sorted.find((e) => e.signature === sig)?.tx ?? null;
    },
  };
}

describe("poolSignatures coverage", () => {
  it("stops paging after MAX_PAGES (20 pages) with complete=false", async () => {
    // 20 pages of exactly 1000 sigs each, all within range, last page is full
    const entries = Array.from({ length: 20000 }, (_, i) => ({ signature: `s${i}`, slot: 1000 + i }));
    const rpc = ledger(entries);
    const { sigs, complete } = await poolSignatures(rpc, "P", 1000, 20999);
    expect(complete).toBe(false);
    expect(rpc.calls).toBe(20);
  });

  it("returns empty result with complete=true when no signatures exist", async () => {
    const rpc = ledger([]);
    const { sigs, complete } = await poolSignatures(rpc, "P", 100, 200);
    expect(complete).toBe(true);
    expect(sigs).toHaveLength(0);
    expect(rpc.calls).toBe(1);
  });

  it("stops early with complete=true when last page has fewer than 1000 sigs", async () => {
    const entries = Array.from({ length: 2500 }, (_, i) => ({ signature: `s${i}`, slot: 100 + i }));
    const rpc = ledger(entries);
    const { sigs, complete } = await poolSignatures(rpc, "P", 100, 3000);
    expect(complete).toBe(true);
    expect(rpc.calls).toBeLessThan(5);
  });

  it("stops early with complete=true when last signature is before fromSlot", async () => {
    const entries = [
      { signature: "early", slot: 50 },
      ...Array.from({ length: 1001 }, (_, i) => ({ signature: `s${i}`, slot: 100 + i })),
    ];
    const rpc = ledger(entries);
    const { sigs, complete } = await poolSignatures(rpc, "P", 100, 2000);
    expect(complete).toBe(true);
  });

  it("filters out signatures with non-null err field", async () => {
    const rpc = ledger([
      { signature: "a", slot: 100 },
      { signature: "b", slot: 101, err: { InstructionError: [] } },
      { signature: "c", slot: 102 },
    ]);
    const { sigs } = await poolSignatures(rpc, "P", 100, 102);
    expect(sigs.map((s) => s.signature)).toEqual(["a", "c"]);
  });

  it("filters out signatures outside the slot range", async () => {
    const rpc = ledger([
      { signature: "a", slot: 99 },
      { signature: "b", slot: 100 },
      { signature: "c", slot: 110 },
      { signature: "d", slot: 111 },
    ]);
    const { sigs } = await poolSignatures(rpc, "P", 100, 110);
    expect(sigs.map((s) => s.signature)).toEqual(["b", "c"]);
  });
});

describe("crawlWindow coverage", () => {
  const init = fx("init");
  const swap = fx("swap-direct");
  const ev = decodeTx(init).find((e) => e.kind === "init")!;
  const swapEv = decodeTx(swap).find((e) => e.kind === "swap")!;
  if (ev.kind !== "init") throw new Error("fixture");
  if (swapEv.kind !== "swap") throw new Error("fixture");

  it("opens at first swap when timestamp activation finds a matching swap", async () => {
    // init contains a swap event; use activation point lower than that swap's timestamp
    const initSwapTimestamp = decodeTx(init).find((e) => e.kind === "swap")?.currentTimestamp ?? 0n;
    const activationPoint = initSwapTimestamp - 1n; // activation point just before the swap in init
    const futureEv = { ...ev, activationPoint };
    const rpc = ledger([
      { signature: init.transaction.signatures[0], slot: init.slot, tx: init },
    ]);
    const r = await crawlWindow(rpc, futureEv, null, init.slot + 50);
    // Window should open at the slot with the swap that reached activation point
    expect(r.open).not.toBeNull();
    expect(r.swaps.length).toBeGreaterThan(0);
  });

  it("window includes swaps within the activation window", async () => {
    const rpc = ledger([
      { signature: init.transaction.signatures[0], slot: init.slot, tx: init },
      { signature: swap.transaction.signatures[0], slot: swap.slot, tx: swap },
    ]);
    const r = await crawlWindow(rpc, ev, ev.slot, swap.slot + 100);
    expect(r.swaps.length).toBeGreaterThan(0);
    expect(r.swaps.every((s) => inWindow(s.slot, r.open!))).toBe(true);
  });

  it("marks incomplete when some fetched txs are null", async () => {
    const rpc = ledger([
      { signature: init.transaction.signatures[0], slot: init.slot, tx: init },
      { signature: "missing", slot: init.slot + 5, tx: null },
    ]);
    const r = await crawlWindow(rpc, ev, ev.slot, init.slot + 50);
    expect(r.complete).toBe(false);
  });

  it("sets createBlockTime to null when creation tx is not found", async () => {
    const rpc = ledger([
      { signature: "other-sig", slot: init.slot, tx: swap },
    ]);
    const r = await crawlWindow(rpc, ev, ev.slot, init.slot + 50);
    expect(r.createBlockTime).toBeNull();
  });

  it("preserves createBlockTime from creation tx", async () => {
    const rpc = ledger([
      { signature: init.transaction.signatures[0], slot: init.slot, tx: init },
      { signature: swap.transaction.signatures[0], slot: swap.slot, tx: swap },
    ]);
    const r = await crawlWindow(rpc, ev, ev.slot, swap.slot + 50);
    expect(r.createBlockTime).toBe(init.blockTime);
  });

  it("returns empty swaps when no transactions can be fetched", async () => {
    const rpc = ledger([
      { signature: init.transaction.signatures[0], slot: init.slot, tx: null },
    ]);
    const r = await crawlWindow(rpc, ev, ev.slot, init.slot + 50);
    expect(r.swaps).toHaveLength(0);
    expect(r.complete).toBe(false);
  });

  it("marks incomplete when creation signature missing (lagging node)", async () => {
    const rpc = ledger([
      { signature: "later-sig", slot: init.slot + 3, tx: swap },
    ]);
    const r = await crawlWindow(rpc, ev, ev.slot, init.slot + 50);
    expect(r.complete).toBe(false);
  });

  it("filters swaps to only those with matching pool", async () => {
    const rpc = ledger([
      { signature: init.transaction.signatures[0], slot: init.slot, tx: init },
      { signature: swap.transaction.signatures[0], slot: swap.slot, tx: swap },
    ]);
    const wrongPoolEv = { ...ev, pool: "wrong-pool" };
    const r = await crawlWindow(rpc, wrongPoolEv, ev.slot, swap.slot + 50);
    expect(r.swaps).toHaveLength(0);
  });

  it("timestamp activation with no matching swaps returns open=null and creates blockTime", async () => {
    const rpc = ledger([
      { signature: init.transaction.signatures[0], slot: init.slot, tx: init },
    ]);
    const futureEv = { ...ev, activationPoint: BigInt(10n ** 18n) };
    const r = await crawlWindow(rpc, futureEv, null, init.slot + 50);
    expect(r.open).toBeNull();
    expect(r.swaps).toHaveLength(0);
    expect(r.createBlockTime).toBe(init.blockTime);
  });

  it("timestamp activation with no swap and no creation tx returns null createBlockTime", async () => {
    const modifiedInit = { ...init, blockTime: null };
    const rpc = ledger([
      { signature: init.transaction.signatures[0], slot: init.slot, tx: modifiedInit },
    ]);
    const futureEv = { ...ev, activationPoint: BigInt(10n ** 18n) };
    const r = await crawlWindow(rpc, futureEv, null, init.slot + 50);
    expect(r.open).toBeNull();
    expect(r.createBlockTime).toBeNull();
  });
});
