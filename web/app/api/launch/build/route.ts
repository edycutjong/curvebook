import { Connection, PublicKey } from "@solana/web3.js";
import { buildLaunchTx } from "@curvebook/core";
import { sql } from "@/lib/db";
import { clientIp, rateLimiter } from "@/lib/ratelimit";
import { solToLamports, validateLaunch } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allow = rateLimiter(10, 60_000);
const TTL_SECONDS = 90;

export async function POST(req: Request) {
  if (!allow(clientIp(req))) return Response.json({ error: "too many launch requests; wait a minute" }, { status: 429 });
  const body = await req.json().catch(() => null);
  const v = validateLaunch(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const input = v.value;

  let creator: PublicKey;
  try {
    creator = new PublicKey(input.wallet);
  } catch {
    return Response.json({ error: "wallet is not a valid Solana address" }, { status: 400 });
  }
  const [preset] = await sql`select config from presets where slug = ${input.preset} or config = ${input.preset}`;
  if (!preset) return Response.json({ error: "unknown preset" }, { status: 400 });

  const connection = new Connection(process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");
  let built;
  try {
    built = await buildLaunchTx({
      connection,
      config: preset.config,
      creator,
      name: input.name,
      symbol: input.symbol,
      uri: input.uri,
      buyAmount: solToLamports(input.buySol),
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 422 });
  }

  const [row] = await sql`insert into issued_tx (hash, preset, wallet, pool, base_mint, last_valid_block_height, expires_at)
    values (${built.messageHash}, ${preset.config}, ${input.wallet}, ${built.pool.toBase58()}, ${built.baseMint.toBase58()},
      ${built.lastValidBlockHeight}, now() + make_interval(secs => ${TTL_SECONDS}))
    returning expires_at`;

  return Response.json({
    tx: Buffer.from(built.tx.serialize()).toString("base64"),
    pool: built.pool.toBase58(),
    baseMint: built.baseMint.toBase58(),
    quote: {
      expectedOut: built.quote.expectedOut.toString(),
      minimumOut: built.quote.minimumOut.toString(),
      fee: built.quote.fee.toString(),
    },
    expiresAt: (row.expires_at as Date).toISOString(),
  });
}
