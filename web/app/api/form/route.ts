import { groupForm } from "@/lib/form";
import { getFormRows } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(groupForm(await getFormRows()));
}
