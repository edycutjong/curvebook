import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeTx, type RawTx } from "@curvebook/core";
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

describe("poolSignatures", () => {
  it("pages back past 1000 signatures until it reaches the creation slot", async () => {
    const entries = Array.from({ length: 2500 }, (_, i) => ({ signature: `s${i}`, slot: 100 + i }));
    const rpc = ledger(entries);
    const { sigs, complete } = await poolSignatures(rpc, "P", 100, 109);
    expect(complete).toBe(true);
    expect(sigs.map((s) => s.slot)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
    expect(rpc.calls).toBe(3);
  });

  it("drops failed transactions", async () => {
    const rpc = ledger([{ signature: "a", slot: 100 }, { signature: "b", slot: 101, err: { InstructionError: [] } }]);
    expect((await poolSignatures(rpc, "P", 100, 109)).sigs.map((s) => s.signature)).toEqual(["a"]);
  });
});

describe("crawlWindow on a real mainnet launch", () => {
  const init = fx("init");
  const ev = decodeTx(init).find((e) => e.kind === "init")!;
  if (ev.kind !== "init") throw new Error("fixture");

  it("rebuilds the creator's bundled buy from the confirmed ledger", async () => {
    const rpc = ledger([{ signature: init.transaction.signatures[0], slot: init.slot, tx: init }]);
    const r = await crawlWindow(rpc, ev, ev.slot, ev.slot + 50);
    expect(r.complete).toBe(true);
    expect(r.open).toBe(ev.slot);
    expect(r.swaps).toHaveLength(1);
    expect(r.swaps[0].payer).toBe(ev.creator);
  });

  it("marks the window incomplete when a transaction cannot be fetched", async () => {
    const rpc = ledger([{ signature: init.transaction.signatures[0], slot: init.slot, tx: null }]);
    expect((await crawlWindow(rpc, ev, ev.slot, ev.slot + 50)).complete).toBe(false);
  });

  it("window_is_incomplete_when_a_lagging_node_omits_the_creation_signature", async () => {
    // A node behind the tip returned only later signatures; without the create tx the window may be short.
    const rpc = ledger([{ signature: "later", slot: init.slot + 3, tx: init }]);
    expect((await crawlWindow(rpc, ev, ev.slot, ev.slot + 50)).complete).toBe(false);
  });

  it("waits when a future timestamp activation has no swap yet", async () => {
    const rpc = ledger([{ signature: init.transaction.signatures[0], slot: init.slot, tx: init }]);
    const future = { ...ev, activationPoint: 10n ** 12n };
    const r = await crawlWindow(rpc, future, null, ev.slot + 50);
    expect(r.open).toBeNull();
  });
});
