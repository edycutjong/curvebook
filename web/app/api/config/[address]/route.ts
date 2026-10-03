import { configView } from "@/lib/config-view";
import { getConfig } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const data = await getConfig(address);
  if (!data) return Response.json({ error: "config not indexed" }, { status: 404 });
  const { raw_b64, ...config } = data.config;
  const view = configView(config.address, raw_b64, config.describe);
  return Response.json({ ...data, config, readout: view.lines, tollBps: view.toll, tollUnit: view.unit });
}
