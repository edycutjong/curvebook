// Yellowstone gRPC source (e.g. RPC Fast): every DBC transaction, server-side filtered,
// with from_slot replay on reconnect so the stream is gapless (≤ 3,500 slots back).
import bs58 from "bs58";
import YellowstoneModule, { CommitmentLevel, type SubscribeRequest } from "@triton-one/yellowstone-grpc";
import { DBC_PROGRAM_ID, type RawTx } from "@curvebook/core";
import type { Indexer } from "../indexer.js";

// The package is CommonJS with a default export; under ESM interop it can arrive wrapped.
const Client: typeof YellowstoneModule = (YellowstoneModule as any).default ?? YellowstoneModule;
const REPLAY_LIMIT = 3_500;
const b58 = (u: Uint8Array) => bs58.encode(u);

/** Convert a Yellowstone SubscribeUpdateTransaction into the getTransaction JSON shape the decoder reads. */
export function yellowstoneToRawTx(update: any): RawTx | null {
  const info = update?.transaction;
  const t = info?.transaction;
  if (!t?.transaction || !t.meta) return null;
  const msg = t.transaction.message;
  return {
    slot: Number(info.slot),
    blockTime: null,
    meta: {
      err: t.meta.err ?? null,
      loadedAddresses: {
        writable: (t.meta.loadedWritableAddresses ?? []).map(b58),
        readonly: (t.meta.loadedReadonlyAddresses ?? []).map(b58),
      },
      innerInstructions: (t.meta.innerInstructions ?? []).map((g: any) => ({
        index: g.index,
        instructions: g.instructions.map((i: any) => ({
          programIdIndex: i.programIdIndex,
          accounts: [...(i.accounts ?? [])],
          data: b58(i.data),
          stackHeight: i.stackHeight ?? null,
        })),
      })),
    },
    transaction: {
      signatures: t.transaction.signatures.map(b58),
      message: {
        accountKeys: msg.accountKeys.map(b58),
        instructions: msg.instructions.map((i: any) => ({ programIdIndex: i.programIdIndex, accounts: [...(i.accounts ?? [])], data: b58(i.data) })),
      },
    },
  };
}

/** gRPC status codes that mean the endpoint will not serve this token (UNAUTHENTICATED, PERMISSION_DENIED). */
const AUTH_CODES = new Set([7, 16]);
/** Consecutive auth failures before giving up on the endpoint (e.g. an expired plan). */
const AUTH_FAILURE_LIMIT = 3;
/** Consecutive failed connections with no data in between before giving up, whatever the error says. */
const GIVE_UP_FAILURES = 8;
const MAX_BACKOFF_MS = 60_000;
/** DBC sees several transactions a second; a stream silent this long is half-open, not idle. */
const SILENCE_MS = 30_000;

export type GrpcOptions = {
  /**
   * Called once when the endpoint keeps rejecting the token, or keeps failing without ever delivering
   * data (about 3 minutes of backoff); the stream is stopped first.
   */
  onAuthFailure?: () => void;
  setTimeout?: typeof setTimeout;
  setInterval?: typeof setInterval;
  now?: () => number;
};

/** A gRPC status from the error, or from its trailing metadata when it surfaces as e.g. 1 CANCELLED. */
export function grpcStatus(e: any): number | undefined {
  const fromMeta = Number(e?.metadata?.get?.("grpc-status")?.[0]);
  if (Number.isInteger(fromMeta) && fromMeta > 0) return fromMeta;
  return typeof e?.code === "number" ? e.code : undefined;
}

export async function startGrpc(ix: Indexer, url: string, token: string, log = console.log, opts: GrpcOptions = {}) {
  const later = opts.setTimeout ?? setTimeout;
  const every = opts.setInterval ?? setInterval;
  const now = opts.now ?? Date.now;
  const client = new Client(url, token || undefined, {
    "grpc.keepalive_time_ms": 30_000,
    "grpc.keepalive_timeout_ms": 10_000,
    "grpc.keepalive_permit_without_calls": 1,
  });
  let reconnects = 0;
  let failures = 0;
  let authFailures = 0;
  let lastFromSlot: number | null = null;
  let stopped = false;
  let lastData = now();
  let current: { retry: (why: string, code?: number) => void } | null = null;

  const giveUp = (why: string) => {
    stopped = true;
    clearInterval(watchdog);
    log(`giving up on gRPC: ${why}`);
    opts.onAuthFailure!();
  };

  const schedule = () => {
    if (opts.onAuthFailure && failures + 1 >= GIVE_UP_FAILURES) return giveUp(`${GIVE_UP_FAILURES} failed connections with no data`);
    const delay = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** Math.min(failures, 6));
    failures++;
    later(() => {
      if (!stopped) connect().catch((e) => { log(`reconnect failed: ${e?.message}`); schedule(); });
    }, delay);
  };

  const connect = async (): Promise<void> => {
    const req: SubscribeRequest = {
      accounts: {}, slots: {}, transactionsStatus: {}, blocks: {}, blocksMeta: {}, entry: {}, accountsDataSlice: [],
      transactions: { dbc: { accountInclude: [DBC_PROGRAM_ID], accountExclude: [], accountRequired: [], vote: false, failed: false } },
      commitment: CommitmentLevel.PROCESSED,
    };
    const gap = ix.chainSlot - ix.lastSlot;
    // lastSlot is a processed slot and chainSlot a confirmed one, so lastSlot can be a few slots ahead.
    if (ix.lastSlot > 0) {
      if (gap <= REPLAY_LIMIT) {
        lastFromSlot = ix.lastSlot;
        req.fromSlot = String(ix.lastSlot);
      } else {
        log(`stream gap of ${gap} slots exceeds replay; pools created in the gap are not indexed`);
      }
    }
    const stream = await client.subscribe();
    stream.write(req);
    lastData = now();
    let closed = false;
    stream.on("data", (u: any) => {
      lastData = now();
      failures = 0;
      authFailures = 0;
      const tx = yellowstoneToRawTx(u);
      if (tx) ix.onTx(tx).catch((e) => log(`onTx: ${e?.message}`));
    });
    const retry = (why: string, code?: number) => {
      if (closed) return;
      closed = true;
      stream.removeAllListeners();
      stream.on("error", () => {}); // a late error after "end" must not become an uncaught exception
      try { stream.cancel(); } catch { /* already closed */ }
      if (code !== undefined && AUTH_CODES.has(code)) authFailures++;
      else authFailures = 0;
      if (authFailures >= AUTH_FAILURE_LIMIT && opts.onAuthFailure) return giveUp(`the endpoint rejected the token ${authFailures} times (${why})`);
      if (stopped) return;
      reconnects++;
      log(`gRPC stream ${why}; reconnecting from slot ${ix.lastSlot}`);
      schedule();
    };
    current = { retry };
    stream.once("error", (e: any) => retry(`error: ${e?.message}`, grpcStatus(e)));
    stream.once("end", () => retry("ended"));
  };

  const watchdog = every(() => {
    if (!stopped && current && now() - lastData > SILENCE_MS) current.retry(`silent for ${SILENCE_MS / 1000} s`);
  }, 10_000);
  (watchdog as any).unref?.();

  await connect();
  return {
    reconnects: () => reconnects,
    lastFromSlot: () => lastFromSlot,
    stop: () => { stopped = true; clearInterval(watchdog); current?.retry("stopped"); },
  };
}
