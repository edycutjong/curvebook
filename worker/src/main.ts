// Curvebook worker: index every DBC launch's first 10 slots, aggregate the Form, land launches.
import { createServer } from "node:http";
import { builder } from "solami";
import { config } from "./env.js";
import { connect, migrate } from "./db.js";
import { Rpc } from "./rpc.js";
import { Indexer } from "./indexer.js";
import { aggregate } from "./agg.js";
import { land, LandError, type Beamer } from "./lander.js";
import { startRpcLogs } from "./sources/rpc-logs.js";
import { startGrpc } from "./sources/grpc.js";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const sql = connect(config.databaseUrl);
await migrate(sql);

const rpc = new Rpc(config.rpcUrl, config.rpcRps);
const source = config.solamiToken ? "grpc" : "rpc";
const indexer = new Indexer(sql, rpc, source, log);
indexer.chainSlot = await rpc.getSlot();
const startedAt = new Date();
const captureStart = (await sql`select capture_start_slot from health where id = 1`)[0]?.capture_start_slot ?? indexer.chainSlot;
await sql`insert into health (id, source, started_at, capture_start_slot) values (1, ${source}, ${startedAt}, ${captureStart})
  on conflict (id) do update set source = excluded.source, started_at = excluded.started_at`;
await indexer.resume();

let beam: Beamer | null = null;
if (config.solamiSwqosKey) {
  const client = await builder().withSwqos(config.solamiSwqosKey).build();
  beam = (tx) => client.beam(tx);
}

const stream = source === "grpc"
  ? await startGrpc(indexer, config.solamiToken, log)
  : startRpcLogs(indexer, rpc, rpc.url, config.wsUrl, log);
log(`worker up: source=${source} landing=${beam ? "beam" : "rpc"} chainSlot=${indexer.chainSlot} captureStart=${captureStart}`);

const every = (ms: number, fn: () => Promise<unknown>) => {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await fn(); } catch (e: any) { log(`${fn.name || "task"}: ${e?.message}`); } finally { busy = false; }
  }, ms);
};

every(2_000, async function chainSlot() { indexer.chainSlot = await rpc.getSlot(); });
every(2_000, async function finalize() { await indexer.tick(); });
if (source === "rpc") every(1_500, async function watched() { await indexer.pollWatched(); });
every(config.aggEverySec * 1_000, async function agg() { const r = await aggregate(sql); log(`agg: ${r.windows} windows, ${r.configs} configs, ${r.ranked} ranked`); });
every(5_000, async function health() {
  const lag = indexer.lastSlot ? Math.max(0, indexer.chainSlot - indexer.lastSlot) : null;
  await sql`update health set last_slot = ${indexer.lastSlot}, chain_slot = ${indexer.chainSlot}, lag_slots = ${lag},
    reconnects = ${stream.reconnects()}, last_from_slot = ${stream.lastFromSlot()},
    pools_seen = pools_seen + ${indexer.stats.poolsSeen}, windows_final = windows_final + ${indexer.stats.windowsFinal},
    windows_incomplete = windows_incomplete + ${indexer.stats.windowsIncomplete}, rpc_errors = ${rpc.errors}, updated_at = now() where id = 1`;
  indexer.stats = { poolsSeen: 0, windowsFinal: 0, windowsIncomplete: 0 };
});
every(300_000, async function prune() {
  await sql`delete from events where id < (select max(id) - 5000 from events)`;
  await sql`delete from issued_tx where expires_at < now()`;
});

const ownWallets = new Set((process.env.OWN_WALLETS ?? "").split(",").filter(Boolean));
const json = (res: any, status: number, body: unknown) => {
  if (res.headersSent) return;
  const text = JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
};
// A failed request or a stray promise must never stop the indexer.
process.on("unhandledRejection", (e: any) => log(`unhandled: ${e?.stack ?? e}`));
process.on("uncaughtException", (e: any) => log(`uncaught: ${e?.stack ?? e}`));

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      const [h] = await sql`select * from health where id = 1`;
      return json(res, 200, { ...h, pending_windows: indexer.pending.size, rpc_backlog: rpc.backlog });
    }
    if (req.headers.authorization !== `Bearer ${config.workerToken}` || !config.workerToken) return json(res, 401, { error: "unauthorized" });
    const body = await new Promise<any>((ok) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch { ok({}); } });
    });
    if (req.method === "POST" && req.url === "/beam") {
      if (typeof body.tx !== "string") return json(res, 400, { error: "tx (base64) required" });
      const r = await land({ sql, rpc, indexer, beam, ownWallets, txBase64: body.tx });
      return json(res, 200, r);
    }
    if (req.method === "POST" && req.url === "/watch") {
      indexer.watch(String(body.pool ?? ""));
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: "not found" });
  } catch (e: any) {
    if (e instanceof LandError) return json(res, e.status, { error: e.message, logs: e.logs });
    log(`http: ${e?.stack ?? e}`);
    json(res, 500, { error: "internal error" });
  }
}).listen(config.port, () => log(`http on :${config.port}`));
