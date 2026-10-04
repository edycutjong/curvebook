import { beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors lib/db.ts's plain(): bigint -> number, Date -> ISO string, everything else passes through.
// Reimplemented here (not imported) so this file never touches the real "postgres" package.
function plain<T>(v: unknown): T {
  return JSON.parse(
    JSON.stringify(v, function (this: Record<string, unknown>, key, val) {
      const raw = this[key];
      if (typeof raw === "bigint") return Number(raw);
      if (raw instanceof Date) return raw.toISOString();
      return val;
    }),
  ) as T;
}

type Call = { text: string; params: unknown[] };

const dbMocks = vi.hoisted(() => ({ sql: vi.fn(), plain }));

vi.mock("@/lib/db", () => dbMocks);

/** Points the shared `sql` mock at a fresh fake tagged-template that serves canned row-sets in call order. */
async function withSql<T>(script: unknown[][], run: () => Promise<T>): Promise<{ result: T; calls: Call[] }> {
  const calls: Call[] = [];
  let i = 0;
  dbMocks.sql.mockImplementation((strings: TemplateStringsArray, ...params: unknown[]) => {
    calls.push({ text: strings.join("¶"), params });
    if (i >= script.length) throw new Error(`sql mock: no scripted result for call #${i} (text: ${strings.join("")})`);
    const rows = script[i++];
    return Promise.resolve(rows);
  });
  const result = await run();
  return { result, calls };
}

beforeEach(() => {
  vi.resetModules();
  dbMocks.sql.mockReset();
});

describe("getHealth", () => {
  it("shapes a present health row and the three counts", async () => {
    const { getHealth } = await import("@/lib/queries");
    const healthRow = {
      source: "worker-1",
      started_at: new Date("2026-10-01T00:00:00.000Z"),
      capture_start_slot: 100n,
      last_slot: 500n,
      chain_slot: 505n,
      lag_slots: 5n,
      reconnects: 2,
      last_from_slot: 90n,
      pools_seen: 10,
      windows_final: 8,
      windows_incomplete: 2,
      skipped_transfer_hook: 0,
      rpc_errors: 0,
      updated_at: new Date("2026-10-04T10:00:00.000Z"),
    };
    const countsRow = { pools: 12n, windows: 9n, configs: 4n };
    const { result, calls } = await withSql([[healthRow], [countsRow]], () => getHealth());

    expect(result.health).toEqual({
      ...healthRow,
      started_at: "2026-10-01T00:00:00.000Z",
      capture_start_slot: 100,
      last_slot: 500,
      chain_slot: 505,
      lag_slots: 5,
      last_from_slot: 90,
      updated_at: "2026-10-04T10:00:00.000Z",
    });
    expect(result.pools).toBe(12);
    expect(result.windows).toBe(9);
    expect(result.configs).toBe(4);
    expect(calls).toHaveLength(2);
  });

  it("returns health: null when the health row is missing", async () => {
    const { getHealth } = await import("@/lib/queries");
    const { result } = await withSql([[], [{ pools: 0n, windows: 0n, configs: 0n }]], () => getHealth());
    expect(result.health).toBeNull();
    expect(result).toEqual({ health: null, pools: 0, windows: 0, configs: 0 });
  });
});

describe("getPresets", () => {
  it("returns the shaped preset list", async () => {
    const { getPresets } = await import("@/lib/queries");
    const rows = [
      {
        config: "cfgA",
        name: "Fast",
        slug: "fast",
        author: "authorA",
        author_bps: 100,
        vault: "vaultA",
        create_sig: "sigA",
        register_sig: "regA",
        network: "mainnet",
      },
    ];
    const { result, calls } = await withSql([rows], () => getPresets());
    expect(result).toEqual(rows);
    expect(calls[0].params).toEqual([]);
  });

  it("returns an empty array when there are no presets", async () => {
    const { getPresets } = await import("@/lib/queries");
    const { result } = await withSql([[]], () => getPresets());
    expect(result).toEqual([]);
  });
});

describe("getFormRows", () => {
  const baseRow = {
    config: "cfg1",
    launches: 5,
    creators: 3,
    top_creator_share: 0.5,
    snp10_p50: 0.04,
    ci_lo: 0.03,
    ci_hi: 0.05,
    median_strip: [1, 2, 3],
    grad_rate: 0.6,
    grad_aged: 4,
    t_grad_p50: 120,
    eligible: true,
    rank: 1,
    tied: false,
    preset_name: null as string | null,
    preset_slug: null as string | null,
  };

  it("maps every numeric/coalesced column and nulls out preset when there is no preset_slug", async () => {
    const { getFormRows } = await import("@/lib/queries");
    const { result } = await withSql([[baseRow]], () => getFormRows());
    expect(result).toEqual([
      {
        config: "cfg1",
        launches: 5,
        creators: 3,
        topCreatorShare: 0.5,
        snp10P50: 0.04,
        ciLo: 0.03,
        ciHi: 0.05,
        medianStrip: [1, 2, 3],
        gradRate: 0.6,
        gradAged: 4,
        tGradP50: 120,
        eligible: true,
        rank: 1,
        tied: false,
        preset: null,
      },
    ]);
  });

  it("builds a preset object when preset_slug is present", async () => {
    const { getFormRows } = await import("@/lib/queries");
    const row = { ...baseRow, preset_name: "Fast", preset_slug: "fast" };
    const { result } = await withSql([[row]], () => getFormRows());
    expect(result[0].preset).toEqual({ name: "Fast", slug: "fast" });
  });

  it("coalesces string-typed counters through Number() and tolerates null analytic fields", async () => {
    const { getFormRows } = await import("@/lib/queries");
    const row = {
      ...baseRow,
      launches: "0",
      creators: "0",
      top_creator_share: "0",
      grad_aged: "0",
      snp10_p50: null,
      ci_lo: null,
      ci_hi: null,
      median_strip: null,
      grad_rate: null,
      t_grad_p50: null,
      eligible: false,
      rank: null,
      tied: false,
    };
    const { result } = await withSql([[row]], () => getFormRows());
    expect(result[0]).toEqual({
      config: "cfg1",
      launches: 0,
      creators: 0,
      topCreatorShare: 0,
      snp10P50: null,
      ciLo: null,
      ciHi: null,
      medianStrip: null,
      gradRate: null,
      gradAged: 0,
      tGradP50: null,
      eligible: false,
      rank: null,
      tied: false,
      preset: null,
    });
  });

  it("returns an empty array when there are no config_stats or presets rows", async () => {
    const { getFormRows } = await import("@/lib/queries");
    const { result } = await withSql([[]], () => getFormRows());
    expect(result).toEqual([]);
  });
});

describe("getConfig", () => {
  const cfgRow = {
    address: "cfgAddr",
    fee_claimer: "claimer",
    quote_mint: "mintQ",
    activation_type: 0,
    swap_base_amount: "1000",
    migration_quote_threshold: "2000",
    pool_creation_fee: "10",
    describe: ["line1", "line2"],
    raw_b64: "YWJj",
    first_seen_slot: 42,
  };
  const windowRow = {
    pool: "poolA",
    create_sig: "sigA",
    created_at: new Date("2026-09-01T00:00:00.000Z"),
    graduated_at: null,
    snp10: 0.05,
    per_slot: [1, 2, 3],
    complete: false,
    buys: 3,
  };
  const countsRow = { pools: 2n, windows: 1n, complete: 0n };
  const presetRow = {
    config: "cfgAddr",
    name: "Fast",
    slug: "fast",
    author: "auth",
    author_bps: 100,
    vault: "vault",
    create_sig: "sigP",
    register_sig: "regP",
    network: "mainnet",
  };
  const formRowForStats = { ...presetRow, config: "cfgAddr", launches: 7, creators: 2, top_creator_share: 0.4,
    snp10_p50: 0.02, ci_lo: 0.01, ci_hi: 0.03, median_strip: null, grad_rate: null, grad_aged: 0,
    t_grad_p50: null, eligible: true, rank: 1, tied: false, preset_name: "Fast", preset_slug: "fast" };

  it("returns null when the config address does not exist", async () => {
    const { getConfig } = await import("@/lib/queries");
    const { result, calls } = await withSql([[], [], [{ pools: 0n, windows: 0n, complete: 0n }], []], () =>
      getConfig("missing"),
    );
    expect(result).toBeNull();
    // Only the first 4 parallel queries run; getFormRows() is never reached.
    expect(calls).toHaveLength(4);
  });

  it("assembles config + stats + windows + counts + preset when everything is present", async () => {
    const { getConfig } = await import("@/lib/queries");
    const { result, calls } = await withSql(
      [[cfgRow], [windowRow], [countsRow], [presetRow], [formRowForStats]],
      () => getConfig("cfgAddr"),
    );
    expect(result?.config).toEqual(plain(cfgRow));
    expect(result?.windows).toEqual(plain([windowRow]));
    expect(result?.counts).toEqual({ pools: 2, windows: 1, complete: 0 });
    expect(result?.preset).toEqual(plain(presetRow));
    expect(result?.stats?.config).toBe("cfgAddr");
    expect(result?.stats?.launches).toBe(7);
    // address is threaded through as a query parameter on every parameterized query.
    expect(calls[0].params).toEqual(["cfgAddr"]);
    expect(calls[1].params).toEqual(["cfgAddr"]);
    // the counts query interpolates the address three times (pools/windows/complete subqueries).
    expect(calls[2].params).toEqual(["cfgAddr", "cfgAddr", "cfgAddr"]);
    expect(calls[3].params).toEqual(["cfgAddr"]);
  });

  it("returns preset: null when no preset row matches, and stats: null when no form row matches", async () => {
    const { getConfig } = await import("@/lib/queries");
    const unrelatedFormRow = { ...formRowForStats, config: "otherCfg" };
    const { result } = await withSql([[cfgRow], [windowRow], [countsRow], [], [unrelatedFormRow]], () =>
      getConfig("cfgAddr"),
    );
    expect(result?.preset).toBeNull();
    expect(result?.stats).toBeNull();
  });

  it("returns empty windows array when the config has no pool windows", async () => {
    const { getConfig } = await import("@/lib/queries");
    const { result } = await withSql([[cfgRow], [], [countsRow], [], []], () => getConfig("cfgAddr"));
    expect(result?.windows).toEqual([]);
  });
});

describe("getPool", () => {
  const poolRow = {
    address: "poolA",
    config: "cfgA",
    creator: "creatorA",
    base_mint: "baseA",
    create_sig: "sigA",
    create_slot: 10,
    created_at: new Date("2026-09-01T00:00:00.000Z"),
    open_slot: 11,
    graduated_at: null,
    graduated_sig: null,
    source: "worker",
    swap_base_amount: "500",
    quote_mint: "quoteA",
  };
  const buyRow = {
    sig: "sigBuy",
    idx: 0,
    slot: 12,
    slot_offset: 1,
    payer: "payerA",
    is_creator: true,
    via_cpi: false,
    quote_in: "100",
    fee: "1",
    base_out: "900",
    confirmed: true,
  };
  const windowRow = { snp10: 0.1, per_slot: [1, 2], nc_wallets: 3, top3_share: 0.9, buys: 1, complete: true, finalized_at: new Date("2026-09-02T00:00:00.000Z") };
  const launchRow = { pool: "poolA", preset: "cfgA", wallet: "walletA", base_mint: "baseA", sig: "sigLaunch", landed_slot: 13, via: "direct", third_party: false, created_at: new Date("2026-09-01T00:05:00.000Z") };

  it("returns null when the pool does not exist", async () => {
    const { getPool } = await import("@/lib/queries");
    const { result, calls } = await withSql([[], [], [], []], () => getPool("missing"));
    expect(result).toBeNull();
    expect(calls).toHaveLength(4);
    expect(calls[0].params).toEqual(["missing"]);
  });

  it("splits swapBaseAmount/quoteMint out of the pool row and shapes buys/window/launch when all present", async () => {
    const { getPool } = await import("@/lib/queries");
    const { result } = await withSql([[poolRow], [buyRow], [windowRow], [launchRow]], () => getPool("poolA"));
    expect(result?.swapBaseAmount).toBe("500");
    expect(result?.quoteMint).toBe("quoteA");
    expect(result?.pool).not.toHaveProperty("swap_base_amount");
    expect(result?.pool).not.toHaveProperty("quote_mint");
    expect(result?.pool).toEqual({
      address: "poolA",
      config: "cfgA",
      creator: "creatorA",
      base_mint: "baseA",
      create_sig: "sigA",
      create_slot: 10,
      created_at: "2026-09-01T00:00:00.000Z",
      open_slot: 11,
      graduated_at: null,
      graduated_sig: null,
      source: "worker",
    });
    expect(result?.buys).toEqual([{ ...buyRow }]);
    expect(result?.window).toEqual(plain(windowRow));
    expect(result?.launch).toEqual(plain(launchRow));
  });

  it("returns window: null and launch: null when neither exists, with an empty buys array", async () => {
    const { getPool } = await import("@/lib/queries");
    const { result } = await withSql([[poolRow], [], [], []], () => getPool("poolA"));
    expect(result?.window).toBeNull();
    expect(result?.launch).toBeNull();
    expect(result?.buys).toEqual([]);
  });
});

describe("getEvents", () => {
  const eventRow = { id: 1, kind: "launch", slot: 100, sig: "sig1", pool: "poolA", config: "cfgA", payer: "payerA", source: "worker", seen_at: new Date("2026-10-01T00:00:00.000Z") };

  it("defaults the limit to 50 when none is given", async () => {
    const { getEvents } = await import("@/lib/queries");
    const { result, calls } = await withSql([[eventRow]], () => getEvents());
    expect(result).toEqual([plain(eventRow)]);
    expect(calls[0].params).toEqual([50]);
  });

  it("truncates a decimal limit", async () => {
    const { getEvents } = await import("@/lib/queries");
    const { calls } = await withSql([[]], () => getEvents(10.9));
    expect(calls[0].params).toEqual([10]);
  });

  it("falls back to 50 when the limit is 0 (falsy)", async () => {
    const { getEvents } = await import("@/lib/queries");
    const { calls } = await withSql([[]], () => getEvents(0));
    expect(calls[0].params).toEqual([50]);
  });

  it("falls back to 50 when the limit is NaN", async () => {
    const { getEvents } = await import("@/lib/queries");
    const { calls } = await withSql([[]], () => getEvents(NaN));
    expect(calls[0].params).toEqual([50]);
  });

  it("clamps a negative limit up to 1", async () => {
    const { getEvents } = await import("@/lib/queries");
    const { calls } = await withSql([[]], () => getEvents(-5));
    expect(calls[0].params).toEqual([1]);
  });

  it("clamps a limit above 200 down to 200", async () => {
    const { getEvents } = await import("@/lib/queries");
    const { calls } = await withSql([[]], () => getEvents(500));
    expect(calls[0].params).toEqual([200]);
  });

  it("returns an empty array when there are no events", async () => {
    const { getEvents } = await import("@/lib/queries");
    const { result } = await withSql([[]], () => getEvents(5));
    expect(result).toEqual([]);
  });
});

describe("getLaunches", () => {
  const launchRow = { pool: "poolA", preset: "cfgA", wallet: "walletA", base_mint: "baseA", sig: "sigLaunch", landed_slot: 13, via: "direct", third_party: false, created_at: new Date("2026-09-01T00:05:00.000Z"), preset_name: "Fast" };

  it("passes the default limit of 50 straight through (no clamping) and shapes rows", async () => {
    const { getLaunches } = await import("@/lib/queries");
    const { result, calls } = await withSql([[launchRow]], () => getLaunches());
    expect(calls[0].params).toEqual([50]);
    expect(result).toEqual([plain(launchRow)]);
  });

  it("passes a custom limit straight through", async () => {
    const { getLaunches } = await import("@/lib/queries");
    const { calls } = await withSql([[]], () => getLaunches(5));
    expect(calls[0].params).toEqual([5]);
  });

  it("carries preset_name: null when the left join misses", async () => {
    const { getLaunches } = await import("@/lib/queries");
    const row = { ...launchRow, preset_name: null };
    const { result } = await withSql([[row]], () => getLaunches());
    expect(result[0].preset_name).toBeNull();
  });

  it("returns an empty array when there are no launches", async () => {
    const { getLaunches } = await import("@/lib/queries");
    const { result } = await withSql([[]], () => getLaunches());
    expect(result).toEqual([]);
  });
});

describe("getPresetBySlug", () => {
  it("returns the shaped preset+config row when the slug matches", async () => {
    const { getPresetBySlug } = await import("@/lib/queries");
    const row = {
      config: "cfgA",
      name: "Fast",
      slug: "fast",
      author: "auth",
      author_bps: 100,
      vault: "vault",
      create_sig: "sigP",
      register_sig: "regP",
      network: "mainnet",
      pool_creation_fee: "10",
      quote_mint: "mintQ",
      raw_b64: "YWJj",
    };
    const { result, calls } = await withSql([[row]], () => getPresetBySlug("fast"));
    expect(result).toEqual(plain(row));
    expect(calls[0].params).toEqual(["fast"]);
  });

  it("returns null when the slug does not exist", async () => {
    const { getPresetBySlug } = await import("@/lib/queries");
    const { result } = await withSql([[]], () => getPresetBySlug("missing"));
    expect(result).toBeNull();
  });

  it("returns pool_creation_fee/quote_mint/raw_b64 as null when the config row is absent (left join miss)", async () => {
    const { getPresetBySlug } = await import("@/lib/queries");
    const row = {
      config: "cfgA",
      name: "Fast",
      slug: "fast",
      author: "auth",
      author_bps: 100,
      vault: "vault",
      create_sig: null,
      register_sig: null,
      network: "mainnet",
      pool_creation_fee: null,
      quote_mint: null,
      raw_b64: null,
    };
    const { result } = await withSql([[row]], () => getPresetBySlug("fast"));
    expect(result?.pool_creation_fee).toBeNull();
    expect(result?.quote_mint).toBeNull();
    expect(result?.raw_b64).toBeNull();
  });
});

describe("getJudgeFacts", () => {
  const healthRow = {
    source: "worker-1",
    started_at: new Date("2026-10-01T00:00:00.000Z"),
    capture_start_slot: 100n,
    last_slot: 500n,
    chain_slot: 505n,
    lag_slots: 5n,
    reconnects: 2,
    last_from_slot: 90n,
    pools_seen: 10,
    windows_final: 8,
    windows_incomplete: 2,
    skipped_transfer_hook: 0,
    rpc_errors: 0,
    updated_at: new Date("2026-10-04T10:00:00.000Z"),
  };
  const countsRow = { pools: 5n, configs: 3n, buys: 42n };

  it("shapes health, counts, receiptPool and topConfig when all are present", async () => {
    const { getJudgeFacts } = await import("@/lib/queries");
    const receiptRow = { pool: "poolReceipt" };
    const topRow = { config: "cfgTop", launches: 9n, name: "Fast" };
    const { result } = await withSql([[healthRow], [countsRow], [receiptRow], [topRow]], () => getJudgeFacts());
    expect(result.health).toEqual(plain(healthRow));
    expect(result.pools).toBe(5);
    expect(result.configs).toBe(3);
    expect(result.buys).toBe(42);
    expect(result.receiptPool).toBe("poolReceipt");
    expect(result.topConfig).toEqual({ config: "cfgTop", launches: 9, name: "Fast" });
  });

  it("returns health: null, receiptPool: null and topConfig: null when all three are absent", async () => {
    const { getJudgeFacts } = await import("@/lib/queries");
    const { result } = await withSql([[], [countsRow], [], []], () => getJudgeFacts());
    expect(result.health).toBeNull();
    expect(result.receiptPool).toBeNull();
    expect(result.topConfig).toBeNull();
    expect(result.pools).toBe(5);
    expect(result.configs).toBe(3);
    expect(result.buys).toBe(42);
  });
});
