import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DBC_PROGRAM_ID } from "@curvebook/core";
import type { Indexer } from "../src/indexer.js";
import { yellowstoneToRawTx } from "../src/sources/grpc.js";

// Shared mock state for the "solami" module, built once via vi.hoisted so the
// vi.mock factory below (which is hoisted above imports) can close over it.
const h = vi.hoisted(() => {
  const streams: EventEmitter[] = [];
  const subBuilders: Array<{ calls: any[] }> = [];

  const subscribe = vi.fn(async (_req: any) => {
    const s = new EventEmitter();
    streams.push(s);
    return s;
  });
  const grpcClient = { subscribe };
  const buildFn = vi.fn(async () => ({ grpc: () => grpcClient }));
  const withGrpc = vi.fn((_token: string) => ({ build: buildFn }));
  const builderFn = vi.fn(() => ({ withGrpc }));

  class SubscriptionBuilder {
    calls: any[] = [];
    constructor() {
      subBuilders.push(this);
    }
    transactions(label: string, filter: any) {
      this.calls.push({ m: "transactions", label, filter });
      return this;
    }
    commitment(level: any) {
      this.calls.push({ m: "commitment", level });
      return this;
    }
    fromSlot(slot: any) {
      this.calls.push({ m: "fromSlot", slot });
      return this;
    }
    build() {
      return { calls: this.calls };
    }
  }

  return { streams, subBuilders, subscribe, grpcClient, buildFn, withGrpc, builderFn, SubscriptionBuilder };
});

vi.mock("solami", () => ({
  builder: h.builderFn,
  CommitmentLevel: { PROCESSED: "processed" },
  SubscriptionBuilder: h.SubscriptionBuilder,
}));

const { startGrpc } = await import("../src/sources/grpc.js");

function fakeIndexer(chainSlot: number, lastSlot: number, onTx = vi.fn(async (_tx: any) => {})): Indexer {
  return { chainSlot, lastSlot, onTx } as unknown as Indexer;
}

/** A minimal, structurally valid Yellowstone update, with every optional field omitted. */
function minimalUpdate() {
  return {
    transaction: {
      slot: "100",
      transaction: {
        transaction: {
          signatures: [new Uint8Array([1, 2, 3])],
          message: {
            accountKeys: [new Uint8Array([4, 5, 6])],
            instructions: [{ programIdIndex: 0, data: new Uint8Array([7]) }],
          },
        },
        meta: {
          innerInstructions: [{ index: 0, instructions: [{ programIdIndex: 0, data: new Uint8Array([8]) }] }],
        },
      },
    },
  };
}

beforeEach(() => {
  h.streams.length = 0;
  h.subBuilders.length = 0;
  h.subscribe.mockClear();
  h.subscribe.mockImplementation(async (_req: any) => {
    const s = new EventEmitter();
    h.streams.push(s);
    return s;
  });
  h.buildFn.mockClear();
  h.buildFn.mockImplementation(async () => ({ grpc: () => h.grpcClient }));
  h.withGrpc.mockClear();
  h.builderFn.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("yellowstoneToRawTx — missing-field branches", () => {
  it("returns null when meta is missing", () => {
    const u = minimalUpdate();
    delete (u.transaction.transaction as any).meta;
    expect(yellowstoneToRawTx(u)).toBeNull();
  });

  it("defaults err to null, loaded addresses to empty arrays, and instruction accounts/stackHeight when absent", () => {
    const u = minimalUpdate();
    const tx = yellowstoneToRawTx(u)!;
    expect(tx.meta!.err).toBeNull();
    expect(tx.meta!.loadedAddresses).toEqual({ writable: [], readonly: [] });
    expect(tx.meta!.innerInstructions![0].instructions[0].accounts).toEqual([]);
    expect(tx.meta!.innerInstructions![0].instructions[0].stackHeight).toBeNull();
    expect(tx.transaction.message.instructions[0].accounts).toEqual([]);
  });

  it("defaults innerInstructions to [] when meta.innerInstructions is absent", () => {
    const u = minimalUpdate();
    delete (u.transaction.transaction.meta as any).innerInstructions;
    const tx = yellowstoneToRawTx(u)!;
    expect(tx.meta!.innerInstructions).toEqual([]);
  });
});

describe("startGrpc", () => {
  it("builds the Solami client from the token and subscribes with the DBC transactions filter at PROCESSED commitment", async () => {
    const ix = fakeIndexer(0, 0);
    const log = vi.fn();
    await startGrpc(ix, "tok-123", log);

    expect(h.builderFn).toHaveBeenCalledTimes(1);
    expect(h.withGrpc).toHaveBeenCalledWith("tok-123");
    expect(h.subBuilders).toHaveLength(1);
    const calls = h.subBuilders[0].calls;
    expect(calls[0]).toEqual({
      m: "transactions",
      label: "dbc",
      filter: { accountInclude: [DBC_PROGRAM_ID], accountExclude: [], accountRequired: [], vote: false, failed: false },
    });
    expect(calls[1]).toEqual({ m: "commitment", level: "processed" });
    // no fromSlot call when lastSlot is 0
    expect(calls.find((c) => c.m === "fromSlot")).toBeUndefined();
  });

  it("does not replay from a slot when lastSlot has already caught up to chainSlot (gap <= 0)", async () => {
    const ix = fakeIndexer(100, 100);
    const log = vi.fn();
    const result = await startGrpc(ix, "tok", log);
    expect(h.subBuilders[0].calls.find((c) => c.m === "fromSlot")).toBeUndefined();
    expect(result.lastFromSlot()).toBeNull();
  });

  it("replays from lastSlot when the gap is within the replay limit", async () => {
    const ix = fakeIndexer(1_000, 500); // gap = 500, within 3500
    const log = vi.fn();
    const result = await startGrpc(ix, "tok", log);
    expect(h.subBuilders[0].calls.find((c) => c.m === "fromSlot")).toEqual({ m: "fromSlot", slot: 500 });
    expect(result.lastFromSlot()).toBe(500);
    expect(log).not.toHaveBeenCalled();
  });

  it("logs and skips replay when the gap exceeds the replay limit", async () => {
    const ix = fakeIndexer(10_000, 100); // gap = 9900 > 3500
    const log = vi.fn();
    const result = await startGrpc(ix, "tok", log);
    expect(h.subBuilders[0].calls.find((c) => c.m === "fromSlot")).toBeUndefined();
    expect(result.lastFromSlot()).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("stream gap of 9900 slots exceeds replay"));
  });

  it("forwards a decodable stream update to indexer.onTx as a converted RawTx", async () => {
    const onTx = vi.fn(async (_tx: any) => {});
    const ix = fakeIndexer(0, 0, onTx);
    await startGrpc(ix, "tok", vi.fn());
    const stream = h.streams[0];

    const update = minimalUpdate();
    stream.emit("data", update);
    // onTx is called synchronously from the "data" handler
    expect(onTx).toHaveBeenCalledTimes(1);
    expect(onTx.mock.calls[0][0]).toEqual(yellowstoneToRawTx(update));
  });

  it("ignores a stream update that does not convert to a RawTx", async () => {
    const onTx = vi.fn(async (_tx: any) => {});
    const ix = fakeIndexer(0, 0, onTx);
    await startGrpc(ix, "tok", vi.fn());
    const stream = h.streams[0];

    stream.emit("data", { slot: { slot: "1" } }); // no `.transaction` -> yellowstoneToRawTx returns null
    expect(onTx).not.toHaveBeenCalled();
  });

  it("logs when indexer.onTx rejects", async () => {
    const onTx = vi.fn(async (_tx: any) => {
      throw new Error("db down");
    });
    const ix = fakeIndexer(0, 0, onTx);
    const log = vi.fn();
    await startGrpc(ix, "tok", log);
    const stream = h.streams[0];

    stream.emit("data", minimalUpdate());
    // the rejection is handled asynchronously (a .catch on the onTx promise)
    await new Promise((r) => setImmediate(r));
    expect(log).toHaveBeenCalledWith("onTx: db down");
  });

  it("on stream error: strips listeners, counts a reconnect, logs, and reconnects after 1s", async () => {
    vi.useFakeTimers();
    const ix = fakeIndexer(0, 0);
    const log = vi.fn();
    const result = await startGrpc(ix, "tok", log);
    const stream = h.streams[0];
    const removeAllListenersSpy = vi.spyOn(stream, "removeAllListeners");

    stream.emit("error", new Error("boom"));

    expect(removeAllListenersSpy).toHaveBeenCalledTimes(1);
    expect(result.reconnects()).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("gRPC stream error: boom; reconnecting from slot 0"));
    expect(h.subscribe).toHaveBeenCalledTimes(1); // reconnect not yet fired

    await vi.advanceTimersByTimeAsync(1_000);

    expect(h.subscribe).toHaveBeenCalledTimes(2); // connect() re-ran after the 1s timeout
    expect(h.streams).toHaveLength(2);
  });

  it("on stream end: counts a reconnect, logs 'ended', and reconnects", async () => {
    vi.useFakeTimers();
    const ix = fakeIndexer(0, 0);
    const log = vi.fn();
    const result = await startGrpc(ix, "tok", log);
    const stream = h.streams[0];

    stream.emit("end");

    expect(result.reconnects()).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("gRPC stream ended; reconnecting from slot 0"));

    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.subscribe).toHaveBeenCalledTimes(2);
  });

  it("logs when the reconnect attempt itself fails", async () => {
    vi.useFakeTimers();
    const ix = fakeIndexer(0, 0);
    const log = vi.fn();
    await startGrpc(ix, "tok", log);
    const stream = h.streams[0];

    h.subscribe.mockImplementationOnce(async () => {
      throw new Error("conn refused");
    });

    stream.emit("error", new Error("boom"));
    await vi.advanceTimersByTimeAsync(1_000);
    // allow the rejected connect().catch(...) microtask to run
    await Promise.resolve();
    await Promise.resolve();

    expect(log).toHaveBeenCalledWith("reconnect failed: conn refused");
  });
});
