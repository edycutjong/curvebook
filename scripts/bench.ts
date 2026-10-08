// pnpm bench: measures the LIVE deployment (no keys, no local services), seeded, warm-ups discarded.
//   1. Freshness: seconds from a launch's 10th slot (block time, public RPC) to its window being public
//      (`seen_at` on the public events feed).
//   2. Read latency: p50/p95 of the public pool / config / Form APIs, sequential (one request at a time).
//   3. Relay attack checks: legitimate-looking wrong inputs to the live launch relay must be refused.
// Exits 1 if any correctness check fails. Override the target with BASE=https://… and RPC=https://….
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { rng } from "@curvebook/core";

const SEED = 42;
const BASE = (process.env.BASE ?? "https://curvebook.edycu.dev").replace(/\/$/, "");
const RPC = process.env.RPC ?? "https://api.mainnet-beta.solana.com";
const WARMUP = 3;
const N_READ = 30;
const N_FRESH = 60;

const rand = rng(SEED);
const failures: string[] = [];
const check = (ok: boolean, what: string) => { if (!ok) failures.push(what); return ok; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Nearest-rank percentile of an already-sorted array. */
const pct = (s: number[], p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, p50: pct(s, 50), p95: pct(s, 95), max: s[s.length - 1] };
};
const pick = <T>(xs: T[], n: number) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
};

async function getJson(path: string) {
  const t0 = performance.now();
  const r = await fetch(BASE + path, { headers: { "user-agent": "curvebook-bench" } });
  const body = await r.json().catch(() => null);
  return { status: r.status, ms: performance.now() - t0, body };
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  for (let i = 0; ; i++) {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (r.status === 429 && i < 5) { await sleep(1_000 * 2 ** i); continue; }
    const j: any = await r.json();
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result as T;
  }
}

async function freshness() {
  const { status, body } = await getJson("/api/verify/events?limit=500");
  check(status === 200, `events feed HTTP ${status}`);
  const windows = (body?.events ?? []).filter((e: any) => e.kind === "window");
  const sample: any[] = pick(windows, N_FRESH);
  const lat: number[] = [];
  for (const e of sample) {
    const bt = await rpc<number | null>("getBlockTime", [e.slot]);
    if (bt == null) continue;
    const s = (Date.parse(e.seen_at) - bt * 1000) / 1000;
    if (check(s > 0 && s < 600, `window ${e.pool}: implausible freshness ${s}s`)) lat.push(s);
    await sleep(350); // public RPC budget
  }
  return { windowsInFeed: windows.length, ...stats(lat) };
}

async function readLatency(paths: string[], validate: (b: any) => boolean, label: string) {
  for (const p of paths.slice(0, WARMUP)) await getJson(p); // warm-up, discarded
  const ms: number[] = [];
  for (const p of paths) {
    const r = await getJson(p);
    check(r.status === 200 && validate(r.body), `${label} ${p}: HTTP ${r.status} or invalid body`);
    ms.push(r.ms);
  }
  return stats(ms);
}

async function relayAttacks() {
  const send = async (tx: string) => {
    const r = await fetch(BASE + "/api/launch/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx }) });
    return { status: r.status, error: String(((await r.json().catch(() => ({}))) as any).error ?? "").slice(0, 70) };
  };
  // A correctly signed v0 transaction this deployment never issued (0-lamport self-transfer from an
  // unfunded throwaway key, so it could never do anything even if a relay forwarded it).
  const kp = Keypair.generate();
  const { value } = await rpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const msg = new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: value.blockhash,
    instructions: [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 0 })] }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([kp]);
  const cases = [
    { name: "signed tx the relay never issued", input: Buffer.from(tx.serialize()).toString("base64"), expect: 403 },
    { name: "oversized payload (> 4,000 chars)", input: "A".repeat(4_001), expect: 400 },
  ];
  const rows = [];
  for (const c of cases) {
    const r = await send(c.input);
    check(r.status === c.expect, `relay case "${c.name}": expected ${c.expect}, got ${r.status}`);
    rows.push({ case: c.name, expected: c.expect, got: r.status, error: r.error });
  }
  return rows;
}

const t0 = Date.now();
console.log(`curvebook bench · ${BASE} · seed ${SEED} · ${new Date().toISOString()}`);

const form = await getJson("/api/form");
check(form.status === 200 && Array.isArray(form.body?.ranked), "Form API");
const configs: string[] = [...(form.body?.ranked ?? []), ...(form.body?.unranked ?? [])].map((r: any) => r.config).filter(Boolean);
const ev = await getJson("/api/verify/events?limit=500");
const pools: string[] = [...new Set<string>((ev.body?.events ?? []).filter((e: any) => e.kind === "window").map((e: any) => e.pool))];

const fresh = await freshness();
const poolLat = await readLatency(pick(pools, N_READ).map((a) => `/api/pool/${a}`),
  (b) => b?.window == null || (b.window.snp10 >= 0 && b.window.snp10 <= 1), "pool");
const configLat = await readLatency(pick(configs, N_READ).map((a) => `/api/config/${a}`), (b) => b != null && !b.error, "config");
const formLat = await readLatency(Array.from({ length: N_READ }, () => "/api/form"), (b) => Array.isArray(b?.ranked), "form");
const attacks = await relayAttacks();

const f = (x: number) => (x < 10 ? x.toFixed(1) : Math.round(x).toString());
console.log(`\n| scenario | n | p50 | p95 | max |\n|---|---|---|---|---|`);
console.log(`| window public after its 10th slot (s) | ${fresh.n} | ${f(fresh.p50)} | ${f(fresh.p95)} | ${f(fresh.max)} |`);
for (const [name, s] of [["GET /api/pool/:address (ms)", poolLat], ["GET /api/config/:address (ms)", configLat], ["GET /api/form (ms)", formLat]] as const)
  console.log(`| ${name} | ${s.n} | ${f(s.p50)} | ${f(s.p95)} | ${f(s.max)} |`);
console.log(`\n| relay attack case | expected | got | relay said |\n|---|---|---|---|`);
for (const a of attacks) console.log(`| ${a.case} | ${a.expected} | ${a.got} | ${a.error} |`);
console.log(`\nwindows in feed sampled from: ${fresh.windowsInFeed} · wall clock ${((Date.now() - t0) / 1000).toFixed(0)} s`);
if (failures.length) {
  console.log(`\nFAIL (${failures.length}):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nall correctness checks passed");
