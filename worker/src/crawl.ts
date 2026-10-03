// Rebuild a pool's first-10-slot window from the confirmed ledger.
//
// Both sources finalize windows this way: the live stream (gRPC, processed) fills
// the strip as it happens, and the window that counts is re-read from confirmed
// signatures of the pool account. A processed tx that was dropped by a fork can
// therefore never reach the Form, and a stream gap cannot leave a window short.
import { decodeTx, inWindow, WINDOW_SLOTS, type InitEvent, type RawTx, type SwapEvent } from "@curvebook/core";

export interface CrawlRpc {
  getSignaturesForAddress(addr: string, opts?: { before?: string; limit?: number }): Promise<{ signature: string; slot: number; err: unknown }[]>;
  getTransaction(sig: string): Promise<RawTx | null>;
}

export type CrawlResult = {
  open: number | null;
  swaps: SwapEvent[];
  /** true when paging reached the pool's creation slot, so no window tx can be missing */
  complete: boolean;
  createBlockTime: number | null;
};

const MAX_PAGES = 20;

/** All confirmed, successful signatures of `pool` with slot in [fromSlot, toSlot], oldest first. */
export async function poolSignatures(rpc: CrawlRpc, pool: string, fromSlot: number, toSlot: number) {
  const out: { signature: string; slot: number }[] = [];
  let before: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const sigs = await rpc.getSignaturesForAddress(pool, { before, limit: 1000 });
    for (const s of sigs) if (!s.err && s.slot >= fromSlot && s.slot <= toSlot) out.push(s);
    const last = sigs.at(-1);
    if (!last || sigs.length < 1000 || last.slot < fromSlot) return { sigs: out.reverse(), complete: true };
    before = last.signature;
  }
  return { sigs: out.reverse(), complete: false };
}

async function fetchAll(rpc: CrawlRpc, sigs: string[]): Promise<RawTx[]> {
  const txs = await Promise.all(sigs.map((s) => rpc.getTransaction(s)));
  return txs.filter((t): t is RawTx => t != null);
}

/**
 * Crawl the window of a pool.
 * `open` is the open slot when known (slot activation, or timestamp activation already
 * reached at creation). For a future timestamp activation pass `open = null` and the
 * window starts at the first swap whose block timestamp reached the activation point.
 */
export async function crawlWindow(rpc: CrawlRpc, init: Pick<InitEvent, "pool" | "slot" | "activationPoint" | "sig">, open: number | null, chainSlot: number): Promise<CrawlResult> {
  const to = open == null ? chainSlot : open + WINDOW_SLOTS - 1;
  const crawl = await poolSignatures(rpc, init.pool, init.slot, to);
  const { sigs } = crawl;
  // A lagging node can answer with a short list; the pool's own creation tx proves we reached its start.
  const complete = crawl.complete && sigs.some((s) => s.signature === init.sig);
  const txs = await fetchAll(rpc, sigs.map((s) => s.signature));
  if (txs.length < sigs.length) return { open, swaps: [], complete: false, createBlockTime: null };

  const createTx = txs.find((t) => t.slot === init.slot);
  const swaps = txs.flatMap((t) => decodeTx(t)).filter((e): e is SwapEvent => e.kind === "swap" && e.pool === init.pool);

  let start = open;
  if (start == null) {
    const first = swaps.find((s) => s.currentTimestamp >= init.activationPoint);
    if (!first) return { open: null, swaps: [], complete: false, createBlockTime: createTx?.blockTime ?? null };
    start = first.slot;
  }
  return {
    open: start,
    swaps: swaps.filter((s) => inWindow(s.slot, start!)),
    complete,
    createBlockTime: createTx?.blockTime ?? null,
  };
}
