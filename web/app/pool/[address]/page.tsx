import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPool } from "@/lib/queries";
import { age, short } from "@/lib/format";
import { Receipt } from "./Receipt";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ address: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address } = await params;
  return { title: `Receipt ${short(address)}` };
}

export default async function PoolPage({ params }: Props) {
  const { address } = await params;
  const data = await getPool(address);
  if (!data) notFound();
  return (
    <>
      <div className="pagehead">
        <p className="capture">
          <Link href={`/config/${data.pool.config}`}>Config {short(data.pool.config)}</Link> / receipt
        </p>
        <h1>Pool {short(address)}</h1>
        <p className="capture">
          Created {age(data.pool.created_at)} by <span className="mono">{short(data.pool.creator)}</span>
          {data.launch ? ` · launched through Curvebook (${data.launch.via})` : ""}
        </p>
      </div>
      <Receipt initial={data} />
    </>
  );
}
