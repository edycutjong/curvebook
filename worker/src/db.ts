import { readFileSync } from "node:fs";
import postgres from "postgres";
import type { ConfigInfo, PoolWindow } from "@curvebook/core";

export type Sql = postgres.Sql;

export function connect(url: string): Sql {
  return postgres(url, {
    max: 5,
    onnotice: () => {},
    ssl: /localhost|127\.0\.0\.1|@db:/.test(url) ? false : "require",
    types: { bigint: postgres.BigInt },
  });
}

export async function migrate(sql: Sql) {
  const schema = readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8");
  await sql.unsafe(schema);
}

const s = (v: bigint | number) => v.toString();

export async function upsertConfig(sql: Sql, c: ConfigInfo, describe: string[], raw: Buffer, slot: number) {
  const baseFee = {
    mode: c.baseFee.mode,
    cliff: s(c.baseFee.cliffFeeNumerator),
    first: c.baseFee.firstFactor,
    second: s(c.baseFee.secondFactor),
    third: s(c.baseFee.thirdFactor),
  };
  await sql`
    insert into configs (address, fee_claimer, quote_mint, activation_type, collect_fee_mode, token_type, swap_base_amount,
      migration_quote_threshold, pool_creation_fee, base_fee, dynamic_fee, enable_first_swap_with_min_fee,
      creator_trading_fee_pct, migration_option, describe, raw_b64, first_seen_slot)
    values (${c.address}, ${c.feeClaimer}, ${c.quoteMint}, ${c.activationType}, ${c.collectFeeMode}, ${c.tokenType},
      ${s(c.swapBaseAmount)}, ${s(c.migrationQuoteThreshold)}, ${s(c.poolCreationFee)}, ${sql.json(baseFee)}, ${c.dynamicFee},
      ${c.enableFirstSwapWithMinFee}, ${c.creatorTradingFeePct}, ${c.migrationOption}, ${describe}, ${raw.toString("base64")}, ${slot})
    on conflict (address) do update set describe = excluded.describe, fetched_at = now()`;
}

export async function writeWindow(sql: Sql, w: PoolWindow, complete: boolean, source: string) {
  await sql.begin(async (tx) => {
    await tx`delete from window_buys where pool = ${w.pool}`;
    const idx = new Map<string, number>();
    for (const b of w.buys) {
      const i = idx.get(b.sig) ?? 0;
      idx.set(b.sig, i + 1);
      await tx`
        insert into window_buys (sig, pool, idx, slot, slot_offset, payer, is_creator, via_cpi, quote_in, fee, base_out, confirmed)
        values (${b.sig}, ${w.pool}, ${i}, ${b.slot}, ${b.offset}, ${b.payer}, ${b.isCreator}, ${b.viaCpi},
          ${s(b.quoteIn)}, ${s(b.fee)}, ${s(b.baseOut)}, true)`;
    }
    await tx`
      insert into pool_windows (pool, config, creator, snp10, per_slot, nc_wallets, top3_share, creator_base, nc_base, nc_fees, buys, complete, source)
      values (${w.pool}, ${w.config}, ${w.creator}, ${w.snp10}, ${w.perSlot}, ${w.ncWallets}, ${w.top3Share},
        ${s(w.creatorBase)}, ${s(w.ncBase)}, ${s(w.ncFees)}, ${w.buys.length}, ${complete}, ${source})
      on conflict (pool) do update set snp10 = excluded.snp10, per_slot = excluded.per_slot, nc_wallets = excluded.nc_wallets,
        top3_share = excluded.top3_share, creator_base = excluded.creator_base, nc_base = excluded.nc_base,
        nc_fees = excluded.nc_fees, buys = excluded.buys, complete = excluded.complete, source = excluded.source,
        finalized_at = now()`;
  });
}

/** Key of the Postgres advisory lock that makes one worker the only writer of an index. */
export const INDEX_LOCK_KEY = 0x63757276; // "curv"

/**
 * Take the index lock on a dedicated connection for the life of the process. Two workers on one
 * database would finalize every window twice (2026-10-04: an orphaned smoke-test worker doubled
 * the health counters and the event feed), so a second worker must refuse to start.
 */
export async function acquireIndexLock(sql: Sql): Promise<boolean> {
  const conn = await sql.reserve();
  const [row] = await conn`select pg_try_advisory_lock(${INDEX_LOCK_KEY}) as locked`;
  if (!row?.locked) conn.release();
  return Boolean(row?.locked);
}
