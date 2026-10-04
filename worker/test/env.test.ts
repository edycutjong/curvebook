import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

async function importEnv(envVars: Record<string, string | undefined>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(envVars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      vi.stubEnv(key, value);
    }
  }
  return import("../src/env.js");
}

describe("env config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("applies default databaseUrl when DATABASE_URL unset", async () => {
    const { config } = await importEnv({ DATABASE_URL: undefined });
    expect(config.databaseUrl).toBe("postgres://curvebook:curvebook@localhost:5433/curvebook");
  });

  it("applies explicit DATABASE_URL override", async () => {
    const { config } = await importEnv({ DATABASE_URL: "postgres://user:pass@host:5432/db" });
    expect(config.databaseUrl).toBe("postgres://user:pass@host:5432/db");
  });

  it("applies default solamiToken empty string when unset", async () => {
    const { config } = await importEnv({ SOLAMI_RPC_TOKEN: undefined });
    expect(config.solamiToken).toBe("");
  });

  it("applies explicit SOLAMI_RPC_TOKEN", async () => {
    const { config } = await importEnv({ SOLAMI_RPC_TOKEN: "secret-token-123" });
    expect(config.solamiToken).toBe("secret-token-123");
  });

  it("applies default solamiSwqosKey empty string when unset", async () => {
    const { config } = await importEnv({ SOLAMI_SWQOS_KEY: undefined });
    expect(config.solamiSwqosKey).toBe("");
  });

  it("applies explicit SOLAMI_SWQOS_KEY", async () => {
    const { config } = await importEnv({ SOLAMI_SWQOS_KEY: "swqos-key-456" });
    expect(config.solamiSwqosKey).toBe("swqos-key-456");
  });

  it("uses explicit RPC_URL override regardless of SOLAMI_RPC_TOKEN", async () => {
    const { config } = await importEnv({ RPC_URL: "https://custom-rpc.example.com", SOLAMI_RPC_TOKEN: "ignored" });
    expect(config.rpcUrl).toBe("https://custom-rpc.example.com");
  });

  it("uses Solami RPC URL when SOLAMI_RPC_TOKEN set and RPC_URL unset", async () => {
    const { config } = await importEnv({ SOLAMI_RPC_TOKEN: "my-token", RPC_URL: undefined });
    expect(config.rpcUrl).toBe("https://rpc.solami.dev/sol?api_key=my-token");
  });

  it("uses public RPC endpoints when SOLAMI_RPC_TOKEN unset and RPC_URL unset", async () => {
    const { config } = await importEnv({ SOLAMI_RPC_TOKEN: undefined, RPC_URL: undefined });
    expect(config.rpcUrl).toBe("https://api.mainnet-beta.solana.com,https://solana-rpc.publicnode.com");
  });

  it("uses explicit WS_URL override regardless of SOLAMI_RPC_TOKEN", async () => {
    const { config } = await importEnv({ WS_URL: "wss://custom-ws.example.com", SOLAMI_RPC_TOKEN: "ignored" });
    expect(config.wsUrl).toBe("wss://custom-ws.example.com");
  });

  it("uses Solami WS URL when SOLAMI_RPC_TOKEN set and WS_URL unset", async () => {
    const { config } = await importEnv({ SOLAMI_RPC_TOKEN: "my-token", WS_URL: undefined });
    expect(config.wsUrl).toBe("wss://ws.solami.dev/ws/sol?api_key=my-token");
  });

  it("uses public WS endpoint when SOLAMI_RPC_TOKEN unset and WS_URL unset", async () => {
    const { config } = await importEnv({ SOLAMI_RPC_TOKEN: undefined, WS_URL: undefined });
    expect(config.wsUrl).toBe("wss://api.mainnet-beta.solana.com");
  });

  it("uses rpcRps 40 when SOLAMI_RPC_TOKEN set and RPC_RPS unset", async () => {
    const { config } = await importEnv({ SOLAMI_RPC_TOKEN: "my-token", RPC_RPS: undefined });
    expect(config.rpcRps).toBe(40);
  });

  it("uses rpcRps 3 when SOLAMI_RPC_TOKEN unset and RPC_RPS unset", async () => {
    const { config } = await importEnv({ SOLAMI_RPC_TOKEN: undefined, RPC_RPS: undefined });
    expect(config.rpcRps).toBe(3);
  });

  it("applies explicit RPC_RPS override regardless of SOLAMI_RPC_TOKEN", async () => {
    const { config } = await importEnv({ RPC_RPS: "25", SOLAMI_RPC_TOKEN: "my-token" });
    expect(config.rpcRps).toBe(25);
  });

  it("applies explicit RPC_RPS override when SOLAMI_RPC_TOKEN unset", async () => {
    const { config } = await importEnv({ RPC_RPS: "7" });
    expect(config.rpcRps).toBe(7);
  });

  it("applies default port 8787 when PORT unset", async () => {
    const { config } = await importEnv({ PORT: undefined });
    expect(config.port).toBe(8787);
  });

  it("applies explicit PORT override", async () => {
    const { config } = await importEnv({ PORT: "9999" });
    expect(config.port).toBe(9999);
  });

  it("applies default empty string workerToken when unset", async () => {
    const { config } = await importEnv({ WORKER_TOKEN: undefined });
    expect(config.workerToken).toBe("");
  });

  it("applies explicit WORKER_TOKEN", async () => {
    const { config } = await importEnv({ WORKER_TOKEN: "shared-secret-xyz" });
    expect(config.workerToken).toBe("shared-secret-xyz");
  });

  it("applies default aggEverySec 60 when unset", async () => {
    const { config } = await importEnv({ AGG_EVERY_SEC: undefined });
    expect(config.aggEverySec).toBe(60);
  });

  it("applies explicit AGG_EVERY_SEC override", async () => {
    const { config } = await importEnv({ AGG_EVERY_SEC: "120" });
    expect(config.aggEverySec).toBe(120);
  });

  it("coerces numeric env vars to numbers with Number()", async () => {
    const { config } = await importEnv({ PORT: "5555", RPC_RPS: "15", AGG_EVERY_SEC: "90" });
    expect(typeof config.port).toBe("number");
    expect(config.port).toBe(5555);
    expect(typeof config.rpcRps).toBe("number");
    expect(config.rpcRps).toBe(15);
    expect(typeof config.aggEverySec).toBe("number");
    expect(config.aggEverySec).toBe(90);
  });

  it("structures config object with correct types", async () => {
    const { config } = await importEnv({});
    expect(config).toHaveProperty("databaseUrl");
    expect(config).toHaveProperty("solamiToken");
    expect(config).toHaveProperty("solamiSwqosKey");
    expect(config).toHaveProperty("rpcUrl");
    expect(config).toHaveProperty("wsUrl");
    expect(config).toHaveProperty("rpcRps");
    expect(config).toHaveProperty("port");
    expect(config).toHaveProperty("workerToken");
    expect(config).toHaveProperty("aggEverySec");
  });

  it("exports WorkerConfig type for use with typeof", async () => {
    const mod = await importEnv({});
    expect(typeof mod.config).toBe("object");
    expect(mod.config).not.toBeNull();
  });
});
