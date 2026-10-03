import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { decodePoolConfig } from "@curvebook/core";
import { bps, short, sol, solscanAccount } from "@/lib/format";
import { getPresetBySlug, getPresets } from "@/lib/queries";
import { LaunchForm } from "./LaunchForm";
import { Providers } from "./Providers";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ preset: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { preset } = await params;
  return { title: `Launch on ${preset}` };
}

export default async function LaunchPage({ params }: Props) {
  const { preset: slug } = await params;
  const presets = await getPresets();
  if (presets.length === 0) {
    return (
      <>
        <div className="pagehead">
          <h1>Launch</h1>
        </div>
        <p className="empty">
          The Curvebook presets are not deployed to mainnet yet, so there is nothing to launch on. The <Link href="/">Form</Link> is live
          meanwhile.
        </p>
      </>
    );
  }
  const preset = await getPresetBySlug(slug);
  if (!preset) notFound();

  let decimals: number | null = null;
  try {
    if (preset.raw_b64) decimals = decodePoolConfig(preset.config, Buffer.from(preset.raw_b64, "base64")).tokenDecimal;
  } catch {
    decimals = null;
  }
  const fee = preset.pool_creation_fee;

  return (
    <>
      <div className="pagehead">
        <p className="capture">
          <Link href={`/config/${preset.config}`}>{preset.name}</Link> / launch
        </p>
        <h1>Launch on {preset.name}</h1>
        <p className="capture">
          {fee == null
            ? "Pool creation fee: not read yet."
            : `Pool creation fee: ${sol(fee)} SOL.`}{" "}
          Fees claimed by this preset&rsquo;s router vault{" "}
          <a href={solscanAccount(preset.vault)} target="_blank" rel="noreferrer" className="mono">{short(preset.vault)}</a> split{" "}
          {bps(preset.author_bps)} to the author and {bps(10_000 - preset.author_bps)} to the treasury.
        </p>
      </div>
      <Providers>
        <LaunchForm slug={preset.slug} tokenDecimals={decimals} />
      </Providers>
    </>
  );
}
