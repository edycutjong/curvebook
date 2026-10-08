// Worker configuration. Every secret comes from the environment; nothing is in the tree.
const env = process.env;
const PUBLIC_RPC = "https://api.mainnet-beta.solana.com,https://solana-rpc.publicnode.com";
const PUBLIC_WS = "wss://api.mainnet-beta.solana.com";

export const config = {
  databaseUrl: env.DATABASE_URL ?? "postgres://curvebook:curvebook@localhost:5433/curvebook",
  /** Yellowstone gRPC endpoint (e.g. RPC Fast): enables the gRPC stream source. Without it the worker runs keyless. */
  grpcUrl: env.GRPC_URL ?? "",
  /** x-token for the gRPC endpoint. */
  grpcToken: env.GRPC_TOKEN ?? "",
  solamiSwqosKey: env.SOLAMI_SWQOS_KEY ?? "",
  /**
   * JSON-RPC endpoints (comma-separated) for crawls, confirmations and landing:
   * RPC_URL when set (e.g. RPC Fast), else two keyless public endpoints sharing the load.
   */
  rpcUrl: env.RPC_URL ?? PUBLIC_RPC,
  /** Sent as the x-token header to the RPC_URL endpoints only (RPC Fast authenticates this way). */
  rpcToken: env.RPC_TOKEN ?? "",
  wsUrl: env.WS_URL ?? PUBLIC_WS,
  /** Keyless endpoints the worker moves to when the provider rejects the token (e.g. the plan expired). */
  rpcFallbackUrl: env.RPC_FALLBACK_URL ?? PUBLIC_RPC,
  rpcFallbackRps: Number(env.RPC_FALLBACK_RPS ?? 3),
  wsFallbackUrl: env.WS_FALLBACK_URL ?? PUBLIC_WS,
  /** Requests per second to the JSON-RPC endpoint (public mainnet tolerates ~4 for heavy methods). */
  rpcRps: Number(env.RPC_RPS ?? 3),
  port: Number(env.PORT ?? 8787),
  /** Shared secret between the web app and the worker's /beam endpoint. */
  workerToken: env.WORKER_TOKEN ?? "",
  aggEverySec: Number(env.AGG_EVERY_SEC ?? 60),
};

export type WorkerConfig = typeof config;
