// Worker configuration. Every secret comes from the environment; nothing is in the tree.
const env = process.env;

export const config = {
  databaseUrl: env.DATABASE_URL ?? "postgres://curvebook:curvebook@localhost:5433/curvebook",
  /** Solami token: enables the gRPC stream source and Solami RPC. Without it the worker runs keyless. */
  solamiToken: env.SOLAMI_RPC_TOKEN ?? "",
  solamiSwqosKey: env.SOLAMI_SWQOS_KEY ?? "",
  /** JSON-RPC used for crawls and confirmations: Solami RPC when a token is set, else public mainnet. */
  rpcUrl: env.RPC_URL ?? (env.SOLAMI_RPC_TOKEN ? `https://rpc.solami.dev/sol?api_key=${env.SOLAMI_RPC_TOKEN}` : "https://api.mainnet-beta.solana.com"),
  wsUrl: env.WS_URL ?? (env.SOLAMI_RPC_TOKEN ? `wss://ws.solami.dev/ws/sol?api_key=${env.SOLAMI_RPC_TOKEN}` : "wss://api.mainnet-beta.solana.com"),
  /** Requests per second to the JSON-RPC endpoint (public mainnet tolerates ~4 for heavy methods). */
  rpcRps: Number(env.RPC_RPS ?? (env.SOLAMI_RPC_TOKEN ? 40 : 4)),
  port: Number(env.PORT ?? 8787),
  /** Shared secret between the web app and the worker's /beam endpoint. */
  workerToken: env.WORKER_TOKEN ?? "",
  aggEverySec: Number(env.AGG_EVERY_SEC ?? 60),
};

export type WorkerConfig = typeof config;
