import "server-only";
import { baseFeeNumeratorAt, decodePoolConfig, describeConfig, feeBps, WINDOW_SLOTS, type ConfigInfo } from "@curvebook/core";

export type ConfigView = {
  info: ConfigInfo | null;
  lines: string[];
  toll: number[] | null; // base fee in bps at offsets 0..9
  unit: "slot" | "second";
  json: string | null;
};

/** Decodes the stored account bytes; falls back to the worker's stored sentences if decoding fails. */
export function configView(address: string, rawB64: string, storedLines: string[]): ConfigView {
  let info: ConfigInfo | null = null;
  try {
    info = decodePoolConfig(address, Buffer.from(rawB64, "base64"));
  } catch {
    info = null;
  }
  if (!info) return { info: null, lines: storedLines, toll: null, unit: "slot", json: null };
  return {
    info,
    lines: describeConfig(info),
    toll: Array.from({ length: WINDOW_SLOTS }, (_, i) => feeBps(baseFeeNumeratorAt(info!, i))),
    unit: info.activationType === 0 ? "slot" : "second",
    json: JSON.stringify(info, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2),
  };
}
