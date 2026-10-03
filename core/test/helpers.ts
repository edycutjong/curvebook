import { readFileSync } from "node:fs";
import { decodePoolConfig, type ConfigInfo, type RawTx, type SwapEvent } from "../src/index.js";

export const fixture = (name: string): RawTx => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

export function configFixture(prefix: string): ConfigInfo {
  const f = JSON.parse(readFileSync(new URL(`./fixtures/config-${prefix}.json`, import.meta.url), "utf8"));
  return decodePoolConfig(f.address, Buffer.from(f.data, "base64"));
}

export function buy(p: Partial<SwapEvent> & { slot: number; payer: string | null; output: bigint }): SwapEvent {
  return {
    kind: "swap", sig: p.sig ?? `sig-${p.slot}-${p.payer}-${p.output}`, blockTime: null, pool: p.pool ?? "P", config: p.config ?? "C",
    tradeDirection: p.tradeDirection ?? 1, hasReferral: false, viaCpi: p.viaCpi ?? false,
    includedFeeInput: p.includedFeeInput ?? 1_000n, excludedFeeInput: p.excludedFeeInput ?? 990n,
    tradingFee: 8n, protocolFee: 2n, referralFee: 0n, currentTimestamp: 0n, transferHook: false, ...p,
  } as SwapEvent;
}
