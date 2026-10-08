// Keyless source: discover launches and graduations from the public logs stream,
// then let the indexer crawl each window from confirmed signatures.
// This is the documented fallback when no gRPC endpoint is configured, or when it rejects the token.
import { Connection, PublicKey } from "@solana/web3.js";
import { DBC_PROGRAM_ID } from "@curvebook/core";
import type { Indexer } from "../indexer.js";
import type { Rpc } from "../rpc.js";

const INIT = /^Program log: Instruction: InitializeVirtualPoolWith/;
const MIGRATE = /^Program log: Instruction: (MigrationDammV2|MigrateMeteoraDamm)$/;

export function startRpcLogs(ix: Indexer, rpc: Rpc, rpcUrl: string, wsUrl: string, log = console.log) {
  const conn = new Connection(rpcUrl, { wsEndpoint: wsUrl, commitment: "confirmed" });
  const seen = new Set<string>();
  let lastMessage = Date.now();
  let reconnects = 0;

  const subscribe = () =>
    conn.onLogs(new PublicKey(DBC_PROGRAM_ID), (l, ctx) => {
      lastMessage = Date.now();
      if (ctx.slot > ix.lastSlot) ix.lastSlot = ctx.slot;
      if (l.err || seen.has(l.signature)) return;
      const isInit = l.logs.some((x) => INIT.test(x));
      const isMigrate = l.logs.some((x) => MIGRATE.test(x));
      if (!isInit && !isMigrate) return;
      seen.add(l.signature);
      if (seen.size > 50_000) seen.clear();
      rpc.getTransaction(l.signature)
        .then((tx) => (tx ? ix.onTx(tx) : undefined))
        .catch((e) => log(`fetch ${l.signature}: ${e?.message}`));
    }, "confirmed");
  let subId = subscribe();

  // The public websocket goes quiet rather than closing; resubscribe when it does.
  setInterval(async () => {
    if (Date.now() - lastMessage < 30_000) return;
    reconnects++;
    log(`logs stream silent for 30 s, resubscribing (#${reconnects})`);
    await conn.removeOnLogsListener(subId).catch(() => {});
    lastMessage = Date.now();
    subId = subscribe();
  }, 10_000).unref();

  return { reconnects: () => reconnects, lastFromSlot: () => null as number | null };
}
