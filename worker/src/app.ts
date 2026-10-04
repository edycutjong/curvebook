// Worker runtime wiring: connects config/db/rpc to a block source, periodic jobs, and the
// HTTP API. Split out of main.ts so the wiring can be driven end-to-end with fakes in tests.
import { createServer, type Server } from "node:http";
import { builder } from "solami";
import type { WorkerConfig } from "./env.js";
import type { Sql } from "./db.js";
import { Rpc } from "./rpc.js";
import { Indexer, type Source } from "./indexer.js";
import { aggregate as realAggregate } from "./agg.js";
import { land as realLand, LandError, type Beamer } from "./lander.js";
import { toJson } from "./json.js";
import { startRpcLogs as realStartRpcLogs } from "./sources/rpc-logs.js";
import { startGrpc as realStartGrpc } from "./sources/grpc.js";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

export type Stream = { reconnects: () => number; lastFromSlot: () => number | null };

export type IndexerFactory = (sql: Sql, rpc: Rpc, source: Source, log: typeof console.log) => Indexer;
export type GrpcStarter = (indexer: Indexer, token: string, log: typeof console.log) => Promise<Stream>;
export type RpcLogsStarter = (indexer: Indexer, rpc: Rpc, rpcUrl: string, wsUrl: string, log: typeof console.log) => Stream;
export type BeamBuilder = (swqosKey: string) => Promise<Beamer>;

export type Deps = {
  config: WorkerConfig;
  sql: Sql;
  rpc: Rpc;
  indexerFactory: IndexerFactory;
  startGrpc: GrpcStarter;
  startRpcLogs: RpcLogsStarter;
  buildBeamer: BeamBuilder;
  aggregate: typeof realAggregate;
  land: typeof realLand;
  setInterval: typeof setInterval;
};

/** The real dependencies main.ts wires up for an actual run. */
export function realDeps(config: WorkerConfig, sql: Sql): Deps {
  return {
    config,
    sql,
    rpc: new Rpc(config.rpcUrl, config.rpcRps),
    indexerFactory: (s, r, source, l) => new Indexer(s, r, source, l),
    startGrpc: realStartGrpc,
    startRpcLogs: realStartRpcLogs,
    buildBeamer: async (swqosKey) => {
      const client = await builder().withSwqos(swqosKey).build();
      return (tx) => client.beam(tx);
    },
    aggregate: realAggregate,
    land: realLand,
    setInterval,
  };
}

/** Runs `fn` on an interval, skipping overlapping ticks and logging (never throwing) on failure. */
export function every(setIntervalFn: typeof setInterval, ms: number, fn: () => Promise<unknown>, logFn: (...a: unknown[]) => void) {
  let busy = false;
  setIntervalFn(async () => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (e: any) {
      logFn(`${fn.name || "task"}: ${e?.message}`);
    } finally {
      busy = false;
    }
  }, ms);
}

/** Write a JSON response; bigint-safe. Guards against writing headers twice. */
export const json = (res: any, status: number, body: unknown) => {
  if (res.headersSent) return;
  const text = toJson(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
};

export type StartedWorker = {
  server: Server;
  indexer: Indexer;
  stream: Stream;
  beam: Beamer | null;
  /** Not used by main.ts (the real process just keeps running); lets tests tear a run down cleanly. */
  stop: () => void;
};

export async function startWorker(deps: Deps): Promise<StartedWorker> {
  const { config, sql, rpc } = deps;
  const source: Source = config.solamiToken ? "grpc" : "rpc";
  const indexer = deps.indexerFactory(sql, rpc, source, log);
  indexer.chainSlot = await rpc.getSlot();
  const startedAt = new Date();
  const captureStart = (await sql`select capture_start_slot from health where id = 1`)[0]?.capture_start_slot ?? indexer.chainSlot;
  await sql`insert into health (id, source, started_at, capture_start_slot) values (1, ${source}, ${startedAt}, ${captureStart})
    on conflict (id) do update set source = excluded.source, started_at = excluded.started_at`;
  await indexer.resume();

  let beam: Beamer | null = null;
  if (config.solamiSwqosKey) beam = await deps.buildBeamer(config.solamiSwqosKey);

  const stream = source === "grpc"
    ? await deps.startGrpc(indexer, config.solamiToken, log)
    : deps.startRpcLogs(indexer, rpc, rpc.url, config.wsUrl, log);
  log(`worker up: source=${source} landing=${beam ? "beam" : "rpc"} chainSlot=${indexer.chainSlot} captureStart=${captureStart}`);

  every(deps.setInterval, 2_000, async function chainSlot() { indexer.chainSlot = await rpc.getSlot(); }, log);
  every(deps.setInterval, 2_000, async function finalize() { await indexer.tick(); }, log);
  if (source === "rpc") every(deps.setInterval, 1_500, async function watched() { await indexer.pollWatched(); }, log);
  every(deps.setInterval, config.aggEverySec * 1_000, async function agg() {
    const r = await deps.aggregate(sql);
    log(`agg: ${r.windows} windows, ${r.configs} configs, ${r.ranked} ranked`);
  }, log);
  every(deps.setInterval, 5_000, async function health() {
    const lag = indexer.lastSlot ? Math.max(0, indexer.chainSlot - indexer.lastSlot) : null;
    await sql`update health set last_slot = ${indexer.lastSlot}, chain_slot = ${indexer.chainSlot}, lag_slots = ${lag},
      reconnects = ${stream.reconnects()}, last_from_slot = ${stream.lastFromSlot()},
      pools_seen = pools_seen + ${indexer.stats.poolsSeen}, windows_final = windows_final + ${indexer.stats.windowsFinal},
      windows_incomplete = windows_incomplete + ${indexer.stats.windowsIncomplete}, rpc_errors = ${rpc.errors}, updated_at = now() where id = 1`;
    indexer.stats = { poolsSeen: 0, windowsFinal: 0, windowsIncomplete: 0 };
  }, log);
  every(deps.setInterval, 300_000, async function prune() {
    await sql`delete from events where id < (select max(id) - 5000 from events)`;
    await sql`delete from issued_tx where expires_at < now()`;
  }, log);

  const ownWallets = new Set((process.env.OWN_WALLETS ?? "").split(",").filter(Boolean));

  // A failed request or a stray promise must never stop the indexer.
  const onUnhandledRejection = (e: any) => log(`unhandled: ${e?.stack ?? e}`);
  const onUncaughtException = (e: any) => log(`uncaught: ${e?.stack ?? e}`);
  process.on("unhandledRejection", onUnhandledRejection);
  process.on("uncaughtException", onUncaughtException);

  const server = createServer(async (req, res) => {
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
        const r = await deps.land({ sql, rpc, indexer, beam, ownWallets, txBase64: body.tx });
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

  return {
    server,
    indexer,
    stream,
    beam,
    stop: () => {
      server.close();
      process.off("unhandledRejection", onUnhandledRejection);
      process.off("uncaughtException", onUncaughtException);
    },
  };
}
