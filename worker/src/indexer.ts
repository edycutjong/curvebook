// Shared indexing logic for both sources (Yellowstone gRPC stream, keyless RPC logs).
import {
  buildWindow, decodeMigrations, decodePoolConfig, decodeTx, describeConfig, openSlot, inWindow,
  DBC_PROGRAM_ID, FINALIZE_LAG_SLOTS, WINDOW_SLOTS,
  type ConfigInfo, type InitEvent, type RawTx, type SwapEvent,
} from "@curvebook/core";
import { crawlWindow } from "./crawl.js";
import { upsertConfig, writeWindow, type Sql } from "./db.js";
import type { Rpc } from "./rpc.js";

type Pending = {
  init: InitEvent;
  open: number | null;
  /** slot after which a crawl is attempted (open + window + finalize lag, or an estimate) */
  dueSlot: number;
  attempts: number;
  watched: boolean;
};

const SLOT_SECONDS = 0.4;
const MAX_ATTEMPTS = 6;
/** Pools older than this at startup are not re-crawled (their early txs are deep in history). */
const RESUME_WINDOW_SLOTS = 9_000; // ≈ 1 h

export type Source = "grpc" | "rpc";

export class Indexer {
  readonly configs = new Map<string, ConfigInfo>();
  readonly pending = new Map<string, Pending>();
  chainSlot = 0;
  lastSlot = 0;
  stats = { poolsSeen: 0, windowsFinal: 0, windowsIncomplete: 0 };
  private crawling = new Set<string>();
  private configFetch = new Map<string, Promise<ConfigInfo | null>>();

  constructor(private sql: Sql, private rpc: Rpc, public source: Source, private log = console.log) {}

  /** Resume windows that were pending when the worker stopped. */
  async resume() {
    const rows = await this.sql`
      select p.*, (l.pool is not null) as watched from pools p
      left join pool_windows w on w.pool = p.address
      left join launches l on l.pool = p.address
      where w.pool is null and p.create_slot > ${this.chainSlot - RESUME_WINDOW_SLOTS}`;
    for (const r of rows) {
      const init: InitEvent = {
        kind: "init", sig: r.create_sig, slot: Number(r.create_slot), blockTime: r.created_at ? Math.floor(r.created_at.getTime() / 1000) : null,
        pool: r.address, config: r.config, creator: r.creator, baseMint: r.base_mint, poolType: 0,
        activationPoint: BigInt(r.activation_point), transferHook: r.transfer_hook,
      };
      this.track(init, r.open_slot == null ? null : Number(r.open_slot), r.watched);
    }
    if (rows.length) this.log(`resumed ${rows.length} pending windows`);
  }

  async config(address: string): Promise<ConfigInfo | null> {
    const hit = this.configs.get(address);
    if (hit) return hit;
    let p = this.configFetch.get(address);
    if (!p) {
      p = (async () => {
        const acc = await this.rpc.getAccountData(address);
        if (!acc || acc.owner !== DBC_PROGRAM_ID) return null;
        const cfg = decodePoolConfig(address, acc.data);
        await upsertConfig(this.sql, cfg, describeConfig(cfg), acc.data, this.lastSlot);
        this.configs.set(address, cfg);
        return cfg;
      })().finally(() => this.configFetch.delete(address));
      this.configFetch.set(address, p);
    }
    return p;
  }

  /** Feed one transaction from a stream (processed or confirmed). */
  async onTx(tx: RawTx) {
    if (tx.slot > this.lastSlot) this.lastSlot = tx.slot;
    for (const e of decodeTx(tx)) {
      if (e.kind === "init") await this.onInit(e);
      else if (e.kind === "swap") await this.onLiveSwap(e);
      else await this.onGraduated(e.pool, e.slot, e.blockTime, e.sig);
    }
    for (const m of decodeMigrations(tx)) await this.onGraduated(m.pool, m.slot, m.blockTime, m.sig);
  }

  async onInit(e: InitEvent) {
    if (this.pending.has(e.pool)) return;
    const cfg = await this.config(e.config);
    if (!cfg) return;
    const open = openSlot(e, cfg.activationType);
    const inserted = await this.sql`
      insert into pools (address, config, creator, base_mint, create_sig, create_slot, created_at, activation_point, open_slot, transfer_hook, source)
      values (${e.pool}, ${e.config}, ${e.creator}, ${e.baseMint}, ${e.sig}, ${e.slot},
        ${e.blockTime ? new Date(e.blockTime * 1000) : new Date()}, ${e.activationPoint.toString()}, ${open}, ${e.transferHook}, ${this.source})
      on conflict (address) do nothing returning address`;
    if (inserted.length) {
      this.stats.poolsSeen++;
      await this.event("init", e.slot, e.sig, e.pool, e.config, e.creator, { activation_point: e.activationPoint.toString(), open_slot: open });
    }
    const watched = (await this.sql`select 1 from launches where pool = ${e.pool}`).length > 0;
    this.track(e, open, watched);
  }

  private track(init: InitEvent, open: number | null, watched: boolean) {
    const estimate = open ?? init.slot + Math.max(0, Math.ceil((Number(init.activationPoint) - (init.blockTime ?? 0)) / SLOT_SECONDS));
    this.pending.set(init.pool, { init, open, dueSlot: estimate + WINDOW_SLOTS + FINALIZE_LAG_SLOTS, attempts: 0, watched });
  }

  watch(pool: string) {
    const p = this.pending.get(pool);
    if (p) p.watched = true;
  }

  /** Live (processed) buys fill the receipt strip before the window is finalized. */
  async onLiveSwap(e: SwapEvent) {
    const p = this.pending.get(e.pool);
    if (!p || p.open == null || e.tradeDirection !== 1 || !inWindow(e.slot, p.open)) return;
    const isCreator = e.payer === p.init.creator;
    await this.sql`
      insert into window_buys (sig, pool, idx, slot, slot_offset, payer, is_creator, via_cpi, quote_in, fee, base_out, confirmed)
      values (${e.sig}, ${e.pool}, ${0}, ${e.slot}, ${e.slot - p.open}, ${e.payer}, ${isCreator}, ${e.viaCpi},
        ${e.includedFeeInput.toString()}, ${(e.includedFeeInput - e.excludedFeeInput).toString()}, ${e.output.toString()}, false)
      on conflict do nothing`;
    await this.event("buy", e.slot, e.sig, e.pool, e.config, e.payer, { offset: e.slot - p.open, base_out: e.output.toString(), creator: isCreator, via_cpi: e.viaCpi });
  }

  async onGraduated(pool: string, slot: number, blockTime: number | null, sig: string) {
    const r = await this.sql`
      update pools set graduated_slot = ${slot}, graduated_at = ${blockTime ? new Date(blockTime * 1000) : new Date()}, graduated_sig = ${sig}
      where address = ${pool} and graduated_slot is null returning config`;
    if (r.length) await this.event("graduated", slot, sig, pool, r[0].config, null, null);
  }

  /** Finalize every window whose slots are confirmed. Called on a timer. */
  async tick() {
    const due = [...this.pending.values()].filter((p) => this.chainSlot >= p.dueSlot && !this.crawling.has(p.init.pool));
    await Promise.all(due.map((p) => this.finalize(p)));
  }

  private async finalize(p: Pending) {
    const pool = p.init.pool;
    this.crawling.add(pool);
    try {
      const cfg = await this.config(p.init.config);
      if (!cfg) return void this.pending.delete(pool);
      const r = await crawlWindow(this.rpc, p.init, p.open, this.chainSlot);
      if (r.open == null || this.chainSlot < r.open + WINDOW_SLOTS + FINALIZE_LAG_SLOTS) {
        // Timestamp activation not reached yet (or estimate too early): look again later.
        p.dueSlot = this.chainSlot + 75;
        if (++p.attempts > MAX_ATTEMPTS * 4) this.pending.delete(pool);
        return;
      }
      if (!r.complete && ++p.attempts < MAX_ATTEMPTS) {
        p.dueSlot = this.chainSlot + 25 * p.attempts;
        return;
      }
      const w = buildWindow({ pool, config: p.init.config, creator: p.init.creator, openSlot: r.open, swapBaseAmount: cfg.swapBaseAmount, swaps: r.swaps });
      await writeWindow(this.sql, w, r.complete, this.source === "grpc" ? "grpc+rpc" : "rpc");
      await this.sql`update pools set open_slot = ${r.open}, created_at = coalesce(${r.createBlockTime ? new Date(r.createBlockTime * 1000) : null}, created_at) where address = ${pool}`;
      if (r.complete) this.stats.windowsFinal++;
      else this.stats.windowsIncomplete++;
      if (this.source === "rpc") {
        for (const b of w.buys.slice(0, 12)) {
          await this.event("buy", b.slot, b.sig, pool, p.init.config, b.payer, { offset: b.offset, base_out: b.baseOut.toString(), creator: b.isCreator, via_cpi: b.viaCpi });
        }
      }
      await this.event("window", r.open + WINDOW_SLOTS - 1, p.init.sig, pool, p.init.config, null, { snp10: w.snp10, buys: w.buys.length, complete: r.complete });
      this.pending.delete(pool);
    } catch (e: any) {
      p.attempts++;
      p.dueSlot = this.chainSlot + 25 * p.attempts;
      if (p.attempts >= MAX_ATTEMPTS) {
        this.pending.delete(pool);
        this.stats.windowsIncomplete++;
        this.log(`window ${pool} dropped after ${p.attempts} attempts: ${e?.message}`);
      }
    } finally {
      this.crawling.delete(pool);
    }
  }

  /** RPC mode: refresh watched pools every ~1.5 s so the receipt strip fills while the window is open. */
  async pollWatched() {
    for (const p of this.pending.values()) {
      if (!p.watched || p.open == null || this.chainSlot > p.open + WINDOW_SLOTS + 4) continue;
      const sigs = await this.rpc.getSignaturesForAddress(p.init.pool, { limit: 100 });
      const known = new Set((await this.sql`select sig from window_buys where pool = ${p.init.pool}`).map((r) => r.sig));
      for (const s of sigs) {
        if (s.err || known.has(s.signature) || !inWindow(s.slot, p.open)) continue;
        const tx = await this.rpc.getTransaction(s.signature);
        if (tx) await this.onTx(tx);
      }
    }
  }

  async event(kind: string, slot: number, sig: string, pool: string | null, config: string | null, payer: string | null, detail: unknown) {
    await this.sql`insert into events (kind, slot, sig, pool, config, payer, detail, source)
      values (${kind}, ${slot}, ${sig}, ${pool}, ${config}, ${payer}, ${detail ? this.sql.json(detail as any) : null}, ${this.source})`;
  }
}
