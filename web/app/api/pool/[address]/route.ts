import { getPool } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const data = await getPool(address);
  if (!data) return Response.json({ error: "pool not indexed yet" }, { status: 404 });
  return Response.json(data);
}
