import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

export type Snapshot = {
  captureStartSlot: number;
  endSlot: number;
  takenAt: string;
  configs: { address: string; swap_base_amount: string; describe: string[] }[];
  pools: { address: string; config: string; creator: string; create_sig: string; create_slot: number; open_slot: number; created_at: number | null; graduated_at: number | null }[];
  windows: { pool: string; config: string; creator: string; snp10: number; per_slot: number[]; buys: number; complete: boolean }[];
  buys: { sig: string; pool: string; idx: number; slot: number; slot_offset: number; payer: string | null; is_creator: boolean; base_out: string; quote_in: string }[];
  stats: { config: string; launches: number; snp10_p50: number | null; rank: number | null }[];
};

export const LATEST = "fixtures/snapshot-latest.json";

export function writeSnapshot(s: Snapshot) {
  const gz = gzipSync(JSON.stringify(s), { level: 9 });
  const sha256 = createHash("sha256").update(gz).digest("hex");
  const file = `fixtures/snapshot-${s.endSlot}.json.gz`;
  writeFileSync(file, gz);
  const meta = { file, sha256, captureStartSlot: s.captureStartSlot, endSlot: s.endSlot, takenAt: s.takenAt,
    counts: { configs: s.configs.length, pools: s.pools.length, windows: s.windows.length, buys: s.buys.length } };
  writeFileSync(LATEST, JSON.stringify(meta, null, 2) + "\n");
  return meta;
}

export function readSnapshot(path?: string): { snap: Snapshot; sha256: string; file: string } {
  const meta = JSON.parse(readFileSync(LATEST, "utf8"));
  const file = path ?? meta.file;
  const gz = readFileSync(file);
  const sha256 = createHash("sha256").update(gz).digest("hex");
  if (!path && sha256 !== meta.sha256) throw new Error(`snapshot hash mismatch: ${sha256} ≠ ${meta.sha256}`);
  return { snap: JSON.parse(gunzipSync(gz).toString("utf8")), sha256, file };
}
