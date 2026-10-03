// Decode Meteora DBC events from a confirmed transaction.
//
// DBC emits events through Anchor event-CPI: a self-invocation whose data is
// EVENT_IX_TAG (8 bytes) + event discriminator (8 bytes) + borsh fields.
// EvtSwap2 carries no payer, so the buyer is read from the `payer` account of
// the DBC swap/swap2 instruction that emitted the event (top-level or inner).
import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import bs58 from "bs58";
import idlJson from "./dbc-idl.json" with { type: "json" };
import { DBC_PROGRAM_ID } from "./constants.js";

const idl = idlJson as unknown as Idl;
const coder = new BorshCoder(idl);

export const EVENT_IX_TAG = Buffer.from("e445a52e51cb9a1d", "hex");

const ixByDisc = new Map<string, { name: string; accounts: string[] }>();
for (const ix of (idlJson as any).instructions) {
  ixByDisc.set(Buffer.from(ix.discriminator).toString("hex"), {
    name: ix.name,
    accounts: ix.accounts.map((a: any) => a.name),
  });
}

const SWAP_IXS = new Set(["swap", "swap2", "swap2_with_transfer_hook"]);
const INIT_EVENTS = new Set(["EvtInitializePool", "EvtInitializePoolWithTransferHook"]);
const SWAP_EVENTS = new Set(["EvtSwap2", "EvtSwap2WithTransferHook"]);
const COMPLETE_EVENTS = new Set(["EvtCurveComplete", "EvtCurveCompleteWithTransferHook"]);

export type InitEvent = {
  kind: "init";
  sig: string;
  slot: number;
  blockTime: number | null;
  pool: string;
  config: string;
  creator: string;
  baseMint: string;
  poolType: number;
  activationPoint: bigint;
  transferHook: boolean;
};

export type SwapEvent = {
  kind: "swap";
  sig: string;
  slot: number;
  blockTime: number | null;
  pool: string;
  config: string;
  /** 0 = base→quote (sell), 1 = quote→base (buy) */
  tradeDirection: number;
  hasReferral: boolean;
  /** payer account of the DBC swap ix that emitted the event; null if unpaired */
  payer: string | null;
  /** true if the swap ix was invoked by another program (aggregator / bot) */
  viaCpi: boolean;
  includedFeeInput: bigint;
  excludedFeeInput: bigint;
  output: bigint;
  tradingFee: bigint;
  protocolFee: bigint;
  referralFee: bigint;
  currentTimestamp: bigint;
  transferHook: boolean;
};

export type CompleteEvent = {
  kind: "complete";
  sig: string;
  slot: number;
  blockTime: number | null;
  pool: string;
  config: string;
  baseReserve: bigint;
  quoteReserve: bigint;
};

export type DbcEvent = InitEvent | SwapEvent | CompleteEvent;

/** Minimal shape of `getTransaction(sig, { encoding: "json", maxSupportedTransactionVersion: 0 })`. */
export type RawTx = {
  slot: number;
  blockTime?: number | null;
  meta: {
    err: unknown;
    loadedAddresses?: { writable: string[]; readonly: string[] } | null;
    innerInstructions?: {
      index: number;
      instructions: { programIdIndex: number; accounts: number[]; data: string; stackHeight?: number | null }[];
    }[] | null;
  } | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: (string | { pubkey: string })[];
      instructions: { programIdIndex: number; accounts: number[]; data: string; stackHeight?: number | null }[];
    };
  };
};

type FlatIx = { programId: string; accounts: string[]; data: Buffer; stackHeight: number };

const big = (v: any): bigint => BigInt(v.toString());
const pk = (v: any): string => v.toBase58();

export function decodeEventData(data: Buffer): { name: string; data: any } | null {
  if (data.length < 16 || !data.subarray(0, 8).equals(EVENT_IX_TAG)) return null;
  try {
    return coder.events.decode(data.subarray(8).toString("base64"));
  } catch {
    return null;
  }
}

export function instructionName(data: Buffer): string | null {
  return ixByDisc.get(data.subarray(0, 8).toString("hex"))?.name ?? null;
}

/** Flatten one top-level instruction and its inner instructions in execution order. */
function flatten(tx: RawTx): FlatIx[][] {
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  const loaded = tx.meta?.loadedAddresses;
  if (loaded) keys.push(...loaded.writable, ...loaded.readonly);
  const toFlat = (ix: { programIdIndex: number; accounts: number[]; data: string; stackHeight?: number | null }, h: number): FlatIx => ({
    programId: keys[ix.programIdIndex],
    accounts: ix.accounts.map((i) => keys[i]),
    data: Buffer.from(bs58.decode(ix.data)),
    stackHeight: ix.stackHeight ?? h,
  });
  const inner = new Map<number, FlatIx[]>();
  for (const group of tx.meta?.innerInstructions ?? []) {
    inner.set(group.index, group.instructions.map((ix) => toFlat(ix, 2)));
  }
  return tx.transaction.message.instructions.map((ix, i) => [toFlat(ix, 1), ...(inner.get(i) ?? [])]);
}

/**
 * Decode every DBC init / swap / curve-complete event in a transaction.
 * Failed transactions emit nothing and return [].
 */
export function decodeTx(tx: RawTx): DbcEvent[] {
  if (!tx.meta || tx.meta.err) return [];
  const sig = tx.transaction.signatures[0];
  const slot = tx.slot;
  const blockTime = tx.blockTime ?? null;
  const out: DbcEvent[] = [];

  for (const group of flatten(tx)) {
    for (let j = 0; j < group.length; j++) {
      const ix = group[j];
      if (ix.programId !== DBC_PROGRAM_ID) continue;
      const ev = decodeEventData(ix.data);
      if (!ev) continue;

      if (INIT_EVENTS.has(ev.name)) {
        const d = ev.data;
        out.push({
          kind: "init", sig, slot, blockTime,
          pool: pk(d.pool), config: pk(d.config), creator: pk(d.creator), baseMint: pk(d.base_mint),
          poolType: d.pool_type, activationPoint: big(d.activation_point),
          transferHook: ev.name.endsWith("WithTransferHook"),
        });
      } else if (SWAP_EVENTS.has(ev.name)) {
        const d = ev.data;
        const parent = findParentSwap(group, j);
        const r = d.swap_result;
        out.push({
          kind: "swap", sig, slot, blockTime,
          pool: pk(d.pool), config: pk(d.config),
          tradeDirection: d.trade_direction, hasReferral: d.has_referral,
          payer: parent?.payer ?? null, viaCpi: parent ? parent.stackHeight > 1 : false,
          includedFeeInput: big(r.included_fee_input_amount), excludedFeeInput: big(r.excluded_fee_input_amount),
          output: big(r.output_amount), tradingFee: big(r.trading_fee), protocolFee: big(r.protocol_fee),
          referralFee: big(r.referral_fee), currentTimestamp: big(d.current_timestamp),
          transferHook: ev.name.endsWith("WithTransferHook"),
        });
      } else if (COMPLETE_EVENTS.has(ev.name)) {
        const d = ev.data;
        out.push({
          kind: "complete", sig, slot, blockTime,
          pool: pk(d.pool), config: pk(d.config),
          baseReserve: big(d.base_reserve), quoteReserve: big(d.quote_reserve),
        });
      }
    }
  }
  return out;
}

/**
 * The event-CPI is invoked by the DBC instruction that emitted it, so its parent
 * is the nearest earlier DBC instruction exactly one stack level up.
 */
function findParentSwap(group: FlatIx[], eventIdx: number): { payer: string; stackHeight: number } | null {
  const h = group[eventIdx].stackHeight;
  for (let k = eventIdx - 1; k >= 0; k--) {
    const ix = group[k];
    if (ix.stackHeight >= h) continue;
    if (ix.stackHeight < h - 1) return null;
    if (ix.programId !== DBC_PROGRAM_ID) return null;
    const meta = ixByDisc.get(ix.data.subarray(0, 8).toString("hex"));
    if (!meta || !SWAP_IXS.has(meta.name)) return null;
    const payerIdx = meta.accounts.indexOf("payer");
    return { payer: ix.accounts[payerIdx], stackHeight: ix.stackHeight };
  }
  return null;
}
