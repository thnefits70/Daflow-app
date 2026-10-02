import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/guards";
import { getDifferences, getSubmittedCounts } from "@/lib/stockCount";

// Para el admin: conteos enviados por Daniel con sus diferencias.
export async function GET() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const counts = await getSubmittedCounts();
  return NextResponse.json(await Promise.all(counts.map(async (c) => ({ ...c, differences: await getDifferences(c.id) }))));
}
