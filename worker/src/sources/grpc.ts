// Solami Yellowstone gRPC source: every DBC transaction, server-side filtered,
// with from_slot replay on reconnect so the stream is gapless (≤ 3,500 slots back).
import bs58 from "bs58";
import { builder, CommitmentLevel, SubscriptionBuilder } from "solami";
import { DBC_PROGRAM_ID, type RawTx } from "@curvebook/core";
import type { Indexer } from "../indexer.js";

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

export async function startGrpc(ix: Indexer, token: string, log = console.log) {
  const client = await builder().withGrpc(token).build();
  let reconnects = 0;
  let lastFromSlot: number | null = null;

  const connect = async (): Promise<void> => {
    const req = new SubscriptionBuilder()
      .transactions("dbc", { accountInclude: [DBC_PROGRAM_ID], accountExclude: [], accountRequired: [], vote: false, failed: false })
      .commitment(CommitmentLevel.PROCESSED);
    const gap = ix.chainSlot - ix.lastSlot;
    if (ix.lastSlot > 0 && gap > 0) {
      if (gap <= REPLAY_LIMIT) {
        lastFromSlot = ix.lastSlot;
        req.fromSlot(ix.lastSlot);
      } else {
        log(`stream gap of ${gap} slots exceeds replay; pools created in the gap are not indexed`);
      }
    }
    const stream = await client.grpc().subscribe(req.build());
    stream.on("data", (u: any) => {
      const tx = yellowstoneToRawTx(u);
      if (tx) ix.onTx(tx).catch((e) => log(`onTx: ${e?.message}`));
    });
    const retry = (why: string) => {
      stream.removeAllListeners();
      reconnects++;
      log(`gRPC stream ${why}; reconnecting from slot ${ix.lastSlot}`);
      setTimeout(() => connect().catch((e) => log(`reconnect failed: ${e?.message}`)), 1_000);
    };
    stream.once("error", (e: any) => retry(`error: ${e?.message}`));
    stream.once("end", () => retry("ended"));
  };
  await connect();
  return { reconnects: () => reconnects, lastFromSlot: () => lastFromSlot };
}
