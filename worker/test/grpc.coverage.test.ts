import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DBC_PROGRAM_ID } from "@curvebook/core";
import type { Indexer } from "../src/indexer.js";
import { yellowstoneToRawTx } from "../src/sources/grpc.js";

// Shared mock state for the "@triton-one/yellowstone-grpc" module, built once via vi.hoisted so the
// vi.mock factory below (which is hoisted above imports) can close over it.
const h = vi.hoisted(() => {
  const streams: Array<EventEmitter & { write: (req: any) => void; cancel: () => void; req?: any; cancelled?: number }> = [];
  const ctorArgs: any[][] = [];

  const subscribe = vi.fn(async () => {
    const s = Object.assign(new EventEmitter(), {
      req: undefined as any,
      cancelled: 0,
      write(req: any) { s.req = req; },
      cancel() { s.cancelled++; },
    });
    streams.push(s);
    return s;
  });

  class Client {
    constructor(...args: any[]) {
      ctorArgs.push(args);
    }
    subscribe = subscribe;
  }

  return { streams, ctorArgs, subscribe, Client };
});

vi.mock("@triton-one/yellowstone-grpc", () => ({
  default: h.Client,
  CommitmentLevel: { PROCESSED: 0 },
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
  h.ctorArgs.length = 0;
  h.subscribe.mockClear();
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
  it("builds the client from the endpoint and x-token and subscribes with the DBC transactions filter at PROCESSED commitment", async () => {
    const ix = fakeIndexer(0, 0);
    const log = vi.fn();
    await startGrpc(ix, "https://grpc.example", "tok-123", log);

    expect(h.ctorArgs).toEqual([["https://grpc.example", "tok-123", expect.objectContaining({ "grpc.keepalive_time_ms": 30_000 })]]);
    const req = h.streams[0].req;
    expect(req.transactions).toEqual({
      dbc: { accountInclude: [DBC_PROGRAM_ID], accountExclude: [], accountRequired: [], vote: false, failed: false },
    });
    expect(req.commitment).toBe(0);
    // no fromSlot when lastSlot is 0
    expect(req.fromSlot).toBeUndefined();
  });

  it("passes no x-token when the token is empty", async () => {
    await startGrpc(fakeIndexer(0, 0), "https://grpc.example", "", vi.fn());
    expect(h.ctorArgs[0][1]).toBeUndefined();
  });

  it("does not replay from a slot when lastSlot has already caught up to chainSlot (gap <= 0)", async () => {
    const ix = fakeIndexer(100, 100);
    const log = vi.fn();
    const result = await startGrpc(ix, "https://grpc.example", "tok", log);
    expect(h.streams[0].req.fromSlot).toBeUndefined();
    expect(result.lastFromSlot()).toBeNull();
  });

  it("replays from lastSlot when the gap is within the replay limit", async () => {
    const ix = fakeIndexer(1_000, 500); // gap = 500, within 3500
    const log = vi.fn();
    const result = await startGrpc(ix, "https://grpc.example", "tok", log);
    expect(h.streams[0].req.fromSlot).toBe("500");
    expect(result.lastFromSlot()).toBe(500);
    expect(log).not.toHaveBeenCalled();
  });

  it("logs and skips replay when the gap exceeds the replay limit", async () => {
    const ix = fakeIndexer(10_000, 100); // gap = 9900 > 3500
    const log = vi.fn();
    const result = await startGrpc(ix, "https://grpc.example", "tok", log);
    expect(h.streams[0].req.fromSlot).toBeUndefined();
    expect(result.lastFromSlot()).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("stream gap of 9900 slots exceeds replay"));
  });

  it("forwards a decodable stream update to indexer.onTx as a converted RawTx", async () => {
    const onTx = vi.fn(async (_tx: any) => {});
    const ix = fakeIndexer(0, 0, onTx);
    await startGrpc(ix, "https://grpc.example", "tok", vi.fn());
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
    await startGrpc(ix, "https://grpc.example", "tok", vi.fn());
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
    await startGrpc(ix, "https://grpc.example", "tok", log);
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
    const result = await startGrpc(ix, "https://grpc.example", "tok", log);
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
    const result = await startGrpc(ix, "https://grpc.example", "tok", log);
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
    await startGrpc(ix, "https://grpc.example", "tok", log);
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

  it("backs off exponentially across failed reconnects and resets after data arrives", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    await startGrpc(fakeIndexer(0, 0), "https://grpc.example", "tok", log);
    h.streams[0].emit("error", new Error("a"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.streams).toHaveLength(2);
    h.streams[1].emit("error", new Error("b")); // second consecutive failure waits 2 s
    await vi.advanceTimersByTimeAsync(1_999);
    expect(h.streams).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.streams).toHaveLength(3);
    h.streams[2].emit("data", { slot: { slot: "1" } }); // data resets the backoff
    h.streams[2].emit("error", new Error("c"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.streams).toHaveLength(4);
  });

  it("cancels the old stream and swallows a late error that follows 'end'", async () => {
    vi.useFakeTimers();
    await startGrpc(fakeIndexer(0, 0), "https://grpc.example", "tok", vi.fn());
    const s = h.streams[0];
    s.emit("end");
    expect(s.cancelled).toBe(1);
    expect(() => s.emit("error", new Error("late"))).not.toThrow();
  });

  it("tolerates a stream whose cancel() throws", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    await startGrpc(fakeIndexer(0, 0), "https://grpc.example", "tok", log);
    h.streams[0].cancel = () => { throw new Error("closed"); };
    h.streams[0].emit("end");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("gRPC stream ended"));
  });

  it("schedules another attempt when a reconnect itself fails", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    await startGrpc(fakeIndexer(0, 0), "https://grpc.example", "tok", log);
    h.subscribe.mockImplementationOnce(async () => { throw new Error("conn refused"); });
    h.streams[0].emit("error", new Error("boom"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(log).toHaveBeenCalledWith("reconnect failed: conn refused");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.streams).toHaveLength(2);
  });

  it("the watchdog reconnects a stream that has been silent for 30 s", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const r = await startGrpc(fakeIndexer(0, 0), "https://grpc.example", "tok", log);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(r.reconnects()).toBe(0);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(r.reconnects()).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("silent for 30 s"));
  });

  it("gives up after 3 consecutive auth rejections and calls onAuthFailure once", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const onAuthFailure = vi.fn();
    const r = await startGrpc(fakeIndexer(0, 0), "https://grpc.example", "tok", log, { onAuthFailure });
    const unauth = () => Object.assign(new Error("16 UNAUTHENTICATED"), { code: 16 });
    h.streams[0].emit("error", unauth());
    await vi.advanceTimersByTimeAsync(1_000);
    h.streams[1].emit("error", Object.assign(new Error("7 PERMISSION_DENIED"), { code: 7 }));
    await vi.advanceTimersByTimeAsync(2_000);
    h.streams[2].emit("error", unauth());
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("rejected the token 3 times"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.streams).toHaveLength(3); // no further attempts, watchdog stopped
    expect(r.reconnects()).toBe(2);
  });

  it("keeps retrying auth rejections when no onAuthFailure handler is given", async () => {
    vi.useFakeTimers();
    await startGrpc(fakeIndexer(0, 0), "https://grpc.example", "tok", vi.fn());
    for (let i = 0; i < 4; i++) {
      h.streams[i].emit("error", Object.assign(new Error("unauth"), { code: 16 }));
      await vi.advanceTimersByTimeAsync(1_000 * 2 ** i); // exactly the backoff, so the 30 s watchdog never fires
    }
    expect(h.streams).toHaveLength(5);
  });

  it("stop() closes the stream and prevents any reconnect", async () => {
    vi.useFakeTimers();
    const r = await startGrpc(fakeIndexer(0, 0), "https://grpc.example", "tok", vi.fn());
    r.stop();
    expect(h.streams[0].cancelled).toBe(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.streams).toHaveLength(1);
    expect(r.reconnects()).toBe(0);
  });

  it("a reconnect timer that fires after stop() does nothing", async () => {
    vi.useFakeTimers();
    const r = await startGrpc(fakeIndexer(0, 0), "https://grpc.example", "tok", vi.fn());
    h.streams[0].emit("error", new Error("boom"));
    r.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.streams).toHaveLength(1);
  });
});

