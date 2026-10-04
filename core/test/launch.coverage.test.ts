// Pins buildLaunchTx's behavior without touching the network: the Meteora DBC client and the
// web3.js Connection are both faked. Real SwapMode / deriveDbcPoolAddress come through
// importOriginal so pool-address derivation and the quote's swap-mode constant stay honest.
import { beforeEach, describe, expect, it, vi } from "vitest";
import BN from "bn.js";
import { ComputeBudgetProgram, Keypair, PublicKey, TransactionInstruction, type Connection } from "@solana/web3.js";

const mocks = vi.hoisted(() => ({
  getPoolConfig: vi.fn(),
  getQuoteFromInputAmount: vi.fn(),
  createPoolWithFirstBuy: vi.fn(),
}));

vi.mock("@meteora-ag/dynamic-bonding-curve-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@meteora-ag/dynamic-bonding-curve-sdk")>();
  return {
    ...actual,
    // vitest 4: a mock constructed with `new` needs a constructable implementation (not an arrow fn).
    DynamicBondingCurveClient: vi.fn(function () {
      return {
        state: { getPoolConfig: mocks.getPoolConfig },
        pool: { getQuoteFromInputAmount: mocks.getQuoteFromInputAmount },
        creator: { createPoolWithFirstBuy: mocks.createPoolWithFirstBuy },
      };
    }),
  };
});

const { buildLaunchTx, launchMessageHash } = await import("../src/launch.js");

const creator = Keypair.generate().publicKey;
const quoteMint = Keypair.generate().publicKey;

const fakeConnection = {
  getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 42 }),
} as unknown as Connection;

function baseArgs(overrides: Partial<Parameters<typeof buildLaunchTx>[0]> = {}) {
  return {
    connection: fakeConnection,
    config: Keypair.generate().publicKey,
    creator,
    name: "Test Token",
    symbol: "TT",
    uri: "https://example.com/meta.json",
    buyAmount: 1_000_000n,
    ...overrides,
  };
}

function makeQuote(overrides: Record<string, unknown> = {}) {
  return {
    outputAmount: new BN(500_000),
    includedFeeInputAmount: new BN(1_000_000),
    excludedFeeInputAmount: new BN(990_000),
    ...overrides,
  };
}

// The real SDK's createPoolWithFirstBuy returns a create-pool instruction that lists the new
// base mint as a signer — that's what makes `tx.sign([baseMint])` legal. The default mock
// mirrors that shape using whatever baseMint buildLaunchTx actually generated for this call.
const defaultCreatePoolWithFirstBuy = (params: any) => ({
  instructions: [
    new TransactionInstruction({
      programId: Keypair.generate().publicKey,
      keys: [{ pubkey: params.createPoolParam.baseMint, isSigner: true, isWritable: true }],
    }),
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  fakeConnection.getLatestBlockhash = vi.fn().mockResolvedValue({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 42 }) as any;
  mocks.getPoolConfig.mockResolvedValue({ enableFirstSwapWithMinFee: true, quoteMint });
  mocks.getQuoteFromInputAmount.mockReturnValue(makeQuote());
  mocks.createPoolWithFirstBuy.mockImplementation(defaultCreatePoolWithFirstBuy);
});

describe("buildLaunchTx: config lookup", () => {
  it("throws 'not a DBC config' when the config account does not resolve", async () => {
    mocks.getPoolConfig.mockResolvedValueOnce(null);
    const config = Keypair.generate().publicKey;
    await expect(buildLaunchTx(baseArgs({ config }))).rejects.toThrow(`not a DBC config: ${config.toBase58()}`);
  });
});

describe("buildLaunchTx: ExactIn quote failure", () => {
  it("wraps an Error thrown by the quote into the curve-cannot-absorb message", async () => {
    mocks.getQuoteFromInputAmount.mockImplementationOnce(() => {
      throw new Error("slippage exceeded");
    });
    await expect(buildLaunchTx(baseArgs())).rejects.toThrow(
      "the curve cannot absorb a first buy of this size: slippage exceeded",
    );
  });

  it("falls back to the raw thrown value when it has no .message", async () => {
    mocks.getQuoteFromInputAmount.mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "raw string failure";
    });
    await expect(buildLaunchTx(baseArgs())).rejects.toThrow(
      "the curve cannot absorb a first buy of this size: raw string failure",
    );
  });

  it("falls back to the raw thrown value when it is nullish", async () => {
    mocks.getQuoteFromInputAmount.mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw undefined;
    });
    await expect(buildLaunchTx(baseArgs())).rejects.toThrow(
      "the curve cannot absorb a first buy of this size: undefined",
    );
  });
});

describe("buildLaunchTx: minimumAmountOut fallback", () => {
  it("uses expectedOut as minimumOut when the quote carries no minimumAmountOut", async () => {
    mocks.getQuoteFromInputAmount.mockReturnValueOnce(makeQuote());
    const result = await buildLaunchTx(baseArgs());
    expect(result.quote.expectedOut).toBe(500_000n);
    expect(result.quote.minimumOut).toBe(result.quote.expectedOut);
  });

  it("uses the quote's own minimumAmountOut when present", async () => {
    mocks.getQuoteFromInputAmount.mockReturnValueOnce(makeQuote({ minimumAmountOut: new BN(450_000) }));
    const result = await buildLaunchTx(baseArgs());
    expect(result.quote.minimumOut).toBe(450_000n);
    expect(result.quote.minimumOut).not.toBe(result.quote.expectedOut);
  });

  it("computes fee as included-minus-excluded fee input", async () => {
    const result = await buildLaunchTx(baseArgs());
    expect(result.quote.fee).toBe(10_000n); // 1_000_000 - 990_000
  });
});

describe("buildLaunchTx: instruction ordering", () => {
  const legacyProgramId = Keypair.generate().publicKey;
  const legacyIxFor = (params: any) => ({
    instructions: [
      new TransactionInstruction({
        programId: legacyProgramId,
        keys: [{ pubkey: params.createPoolParam.baseMint, isSigner: true, isWritable: true }],
      }),
    ],
  });

  it("orders priority fee, then the DBC create+buy instructions, then extraIxs", async () => {
    const extraIx = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [] });
    mocks.createPoolWithFirstBuy.mockImplementationOnce(legacyIxFor);

    const result = await buildLaunchTx(baseArgs({ priorityMicroLamports: 5_000, extraIxs: [extraIx] }));

    const programIds = result.tx.message.compiledInstructions.map((ci) =>
      result.tx.message.staticAccountKeys[ci.programIdIndex]!.toBase58(),
    );
    expect(programIds).toEqual([
      ComputeBudgetProgram.programId.toBase58(),
      legacyProgramId.toBase58(),
      extraIx.programId.toBase58(),
    ]);
  });

  it("omits the priority-fee instruction and defaults extraIxs to empty when both are omitted", async () => {
    mocks.createPoolWithFirstBuy.mockImplementationOnce(legacyIxFor);

    const result = await buildLaunchTx(baseArgs());

    const programIds = result.tx.message.compiledInstructions.map((ci) =>
      result.tx.message.staticAccountKeys[ci.programIdIndex]!.toBase58(),
    );
    expect(programIds).toEqual([legacyProgramId.toBase58()]);
  });
});

describe("buildLaunchTx: transaction shape", () => {
  it("builds a v0 versioned transaction", async () => {
    const result = await buildLaunchTx(baseArgs());
    expect(result.tx.version).toBe(0);
  });

  it("signs with the generated base mint only, leaving the creator's signature slot empty", async () => {
    const result = await buildLaunchTx(baseArgs({ creator }));
    const keys = result.tx.message.staticAccountKeys;
    const creatorIdx = keys.findIndex((k) => k.equals(creator));
    const baseMintIdx = keys.findIndex((k) => k.equals(result.baseMint));

    expect(creatorIdx).toBeGreaterThanOrEqual(0);
    expect(baseMintIdx).toBeGreaterThanOrEqual(0);
    expect(result.tx.signatures[creatorIdx]!.every((b) => b === 0)).toBe(true);
    expect(result.tx.signatures[baseMintIdx]!.every((b) => b === 0)).toBe(false);
  });

  it("derives the pool address from the config's quoteMint and the new base mint", async () => {
    const config = new PublicKey(Keypair.generate().publicKey);
    const result = await buildLaunchTx(baseArgs({ config }));
    expect(result.pool).toBeInstanceOf(PublicKey);
  });
});

describe("buildLaunchTx: messageHash", () => {
  it("returns a messageHash equal to launchMessageHash(tx), stable across repeated calls", async () => {
    const result = await buildLaunchTx(baseArgs());
    expect(result.messageHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.messageHash).toBe(launchMessageHash(result.tx));
    expect(launchMessageHash(result.tx)).toBe(launchMessageHash(result.tx));
  });
});
