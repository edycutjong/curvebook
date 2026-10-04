// Pins startRpcLogs: the keyless onLogs fallback that discovers DBC launches/graduations,
// fetches their transactions, and silently resubscribes when the public websocket goes quiet.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DBC_PROGRAM_ID } from "@curvebook/core";
import type { Indexer } from "../src/indexer.js";
import type { Rpc } from "../src/rpc.js";

type LogsCallback = (l: { err: unknown; logs: string[]; signature: string }, ctx: { slot: number }) => void;
type OnLogsCall = { programId: { toBase58(): string }; callback: LogsCallback; commitment: string; id: number };

// vi.mock factories are hoisted above imports, so the mutable state they close over
// must be created through vi.hoisted to exist before the factory runs.
const state = vi.hoisted(() => ({
  onLogsCalls: [] as OnLogsCall[],
  nextSubId: 1,
  removeOnLogsListener: (_id: number): Promise<void> => Promise.resolve(),
  removedIds: [] as number[],
}));

vi.mock("@solana/web3.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/web3.js")>();
  class FakeConnection {
    constructor(public url: string, public opts: unknown) {}
    onLogs(programId: { toBase58(): string }, callback: LogsCallback, commitment: string) {
      const id = state.nextSubId++;
      state.onLogsCalls.push({ programId, callback, commitment, id });
      return id;
    }
    removeOnLogsListener(id: number) {
      state.removedIds.push(id);
      return state.removeOnLogsListener(id);
    }
  }
  return { ...actual, Connection: FakeConnection };
});

const { startRpcLogs } = await import("../src/sources/rpc-logs.js");

/** The current (latest) subscribed onLogs callback — resubscribing installs a new one. */
const currentSub = () => state.onLogsCalls[state.onLogsCalls.length - 1];

const emit = (signature: string, logs: string[], opts: { err?: unknown; slot?: number } = {}) => {
  currentSub().callback({ err: opts.err ?? null, logs, signature }, { slot: opts.slot ?? 1 });
};

const INIT_LOG = "Program log: Instruction: InitializeVirtualPoolWithSplToken";
const DAMM_LOG = "Program log: Instruction: MigrationDammV2";
const METEORA_LOG = "Program log: Instruction: MigrateMeteoraDamm";
const NOISE_LOG = "Program log: Instruction: Swap";

function makeRpc(getTransaction: Rpc["getTransaction"]) {
  return { getTransaction } as unknown as Rpc;
}

function makeIndexer() {
  return { lastSlot: 0, onTx: vi.fn() } as unknown as Indexer;
}

describe("startRpcLogs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.onLogsCalls = [];
    state.nextSubId = 1;
    state.removedIds = [];
    state.removeOnLogsListener = () => Promise.resolve();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes onLogs for the DBC program over a Connection built from the given URLs", () => {
    const ix = makeIndexer();
    startRpcLogs(ix, makeRpc(async () => null), "https://rpc.example", "wss://rpc.example", vi.fn());
    expect(state.onLogsCalls).toHaveLength(1);
    expect(currentSub().programId.toBase58()).toBe(DBC_PROGRAM_ID);
    expect(currentSub().commitment).toBe("confirmed");
  });

  it("fetches and hands off the transaction for a matching InitializeVirtualPoolWith... log", async () => {
    const ix = makeIndexer();
    const tx = { slot: 5 };
    const getTransaction = vi.fn(async () => tx as any);
    startRpcLogs(ix, makeRpc(getTransaction), "u", "w", vi.fn());
    emit("sig-init", [INIT_LOG]);
    await vi.waitFor(() => expect(getTransaction).toHaveBeenCalledWith("sig-init"));
    await Promise.resolve();
    expect((ix.onTx as any)).toHaveBeenCalledWith(tx);
  });

  it.each([
    ["MigrationDammV2", DAMM_LOG],
    ["MigrateMeteoraDamm", METEORA_LOG],
  ])("fetches and hands off the transaction for a matching %s migration log", async (_name, logLine) => {
    const ix = makeIndexer();
    const tx = { slot: 9 };
    const getTransaction = vi.fn(async () => tx as any);
    startRpcLogs(ix, makeRpc(getTransaction), "u", "w", vi.fn());
    emit("sig-migrate", [logLine]);
    await vi.waitFor(() => expect(getTransaction).toHaveBeenCalledWith("sig-migrate"));
    await Promise.resolve();
    expect((ix.onTx as any)).toHaveBeenCalledWith(tx);
  });

  it("ignores logs that are neither an init nor a migration instruction", async () => {
    const ix = makeIndexer();
    const getTransaction = vi.fn(async () => ({}) as any);
    startRpcLogs(ix, makeRpc(getTransaction), "u", "w", vi.fn());
    emit("sig-noise", [NOISE_LOG]);
    await Promise.resolve();
    await Promise.resolve();
    expect(getTransaction).not.toHaveBeenCalled();
    expect((ix.onTx as any)).not.toHaveBeenCalled();
  });

  it("ignores an errored log entry even when its lines would otherwise match", async () => {
    const ix = makeIndexer();
    const getTransaction = vi.fn(async () => ({}) as any);
    startRpcLogs(ix, makeRpc(getTransaction), "u", "w", vi.fn());
    emit("sig-err", [INIT_LOG], { err: { InstructionError: [] } });
    await Promise.resolve();
    await Promise.resolve();
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("fetches a duplicate signature only once", async () => {
    const ix = makeIndexer();
    const getTransaction = vi.fn(async () => ({ slot: 1 }) as any);
    startRpcLogs(ix, makeRpc(getTransaction), "u", "w", vi.fn());
    emit("sig-dup", [INIT_LOG]);
    emit("sig-dup", [INIT_LOG]);
    await vi.waitFor(() => expect(getTransaction).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(getTransaction).toHaveBeenCalledTimes(1);
  });

  it("skips onTx when getTransaction resolves to null", async () => {
    const ix = makeIndexer();
    const getTransaction = vi.fn(async () => null);
    startRpcLogs(ix, makeRpc(getTransaction), "u", "w", vi.fn());
    emit("sig-null", [INIT_LOG]);
    await vi.waitFor(() => expect(getTransaction).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect((ix.onTx as any)).not.toHaveBeenCalled();
  });

  it("logs a fetch error instead of throwing when getTransaction rejects", async () => {
    const ix = makeIndexer();
    const log = vi.fn();
    const getTransaction = vi.fn(async () => {
      throw new Error("boom");
    });
    startRpcLogs(ix, makeRpc(getTransaction), "u", "w", log);
    emit("sig-fail", [INIT_LOG]);
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith("fetch sig-fail: boom"));
    expect((ix.onTx as any)).not.toHaveBeenCalled();
  });

  it("only raises ix.lastSlot, never lowers it, as log contexts arrive out of order", () => {
    const ix = makeIndexer();
    ix.lastSlot = 10;
    startRpcLogs(ix, makeRpc(async () => null), "u", "w", vi.fn());
    emit("s1", [NOISE_LOG], { slot: 20 });
    expect(ix.lastSlot).toBe(20);
    emit("s2", [NOISE_LOG], { slot: 15 });
    expect(ix.lastSlot).toBe(20);
    emit("s3", [NOISE_LOG], { slot: 25 });
    expect(ix.lastSlot).toBe(25);
  });

  it("clears the seen-signature set once it grows past 50,000 entries, allowing a re-fetch", async () => {
    const ix = makeIndexer();
    const getTransaction = vi.fn(async () => ({ slot: 1 }) as any);
    startRpcLogs(ix, makeRpc(getTransaction), "u", "w", vi.fn());

    emit("seen-0", [INIT_LOG]);
    for (let i = 1; i <= 50_000; i++) emit(`seen-${i}`, [INIT_LOG]);
    expect(getTransaction).toHaveBeenCalledTimes(50_001);

    // The set was cleared on the 50,001st insert, so a previously-seen signature fetches again.
    emit("seen-0", [INIT_LOG]);
    expect(getTransaction).toHaveBeenCalledTimes(50_002);
  }, 30_000);

  it("does not resubscribe while logs keep arriving within the 30 s silence window", async () => {
    const ix = makeIndexer();
    startRpcLogs(ix, makeRpc(async () => null), "u", "w", vi.fn());
    await vi.advanceTimersByTimeAsync(20_000);
    emit("keepalive", [NOISE_LOG]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(state.onLogsCalls).toHaveLength(1);
    expect(state.removedIds).toEqual([]);
  });

  it("resubscribes after 30 s of silence, removing the old listener and counting the reconnect", async () => {
    const ix = makeIndexer();
    const log = vi.fn();
    startRpcLogs(ix, makeRpc(async () => null), "u", "w", log);
    const firstId = currentSub().id;

    await vi.advanceTimersByTimeAsync(40_000);

    expect(state.removedIds).toEqual([firstId]);
    expect(state.onLogsCalls).toHaveLength(2);
    expect(log).toHaveBeenCalledWith("logs stream silent for 30 s, resubscribing (#1)");
  });

  it("swallows a rejected removeOnLogsListener and still resubscribes", async () => {
    const ix = makeIndexer();
    const log = vi.fn();
    state.removeOnLogsListener = () => Promise.reject(new Error("socket already closed"));
    startRpcLogs(ix, makeRpc(async () => null), "u", "w", log);

    await vi.advanceTimersByTimeAsync(40_000);

    expect(state.onLogsCalls).toHaveLength(2);
    expect(log).toHaveBeenCalledWith("logs stream silent for 30 s, resubscribing (#1)");
  });

  it("increments the reconnect counter again on a second silent window, and keeps tracking matches after resubscribing", async () => {
    const ix = makeIndexer();
    const tx = { slot: 3 };
    const getTransaction = vi.fn(async () => tx as any);
    const api = startRpcLogs(ix, makeRpc(getTransaction), "u", "w", vi.fn());

    await vi.advanceTimersByTimeAsync(40_000);
    expect(api.reconnects()).toBe(1);

    await vi.advanceTimersByTimeAsync(40_000);
    expect(api.reconnects()).toBe(2);

    // The new subscription (post-resubscribe) still drives the normal match path.
    emit("after-reconnect", [INIT_LOG]);
    await vi.waitFor(() => expect(getTransaction).toHaveBeenCalledWith("after-reconnect"));
  });

  it("reports reconnects() live and lastFromSlot() as permanently null", () => {
    const ix = makeIndexer();
    const api = startRpcLogs(ix, makeRpc(async () => null), "u", "w", vi.fn());
    expect(api.reconnects()).toBe(0);
    expect(api.lastFromSlot()).toBeNull();
  });
});
