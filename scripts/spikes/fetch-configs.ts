// Save raw PoolConfig accounts referenced by the decode fixtures, for offline tests.
import { writeFileSync } from "node:fs";
import { decodePoolConfig, describeConfig } from "@curvebook/core";
const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const addrs = process.argv.slice(2);
for (const a of addrs) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [a, { encoding: "base64" }] }) });
  const j: any = await r.json();
  const data = j.result.value.data[0];
  writeFileSync(`core/test/fixtures/config-${a.slice(0, 8)}.json`, JSON.stringify({ address: a, owner: j.result.value.owner, data }));
  const c = decodePoolConfig(a, Buffer.from(data, "base64"));
  console.log(a, JSON.stringify(c, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  console.log(describeConfig(c).join("\n"));
}
