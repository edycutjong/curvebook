import { getEvents } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 50);
  return Response.json({ events: await getEvents(limit) });
}
