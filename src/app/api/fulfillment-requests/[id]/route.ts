import { NextRequest, NextResponse } from "next/server";
import { canViewFulfillmentRequests } from "@/lib/guards";
import { getCompiledBatch } from "@/lib/rocketRequest";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canViewFulfillmentRequests())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const { id } = await params;
  const batch = await getCompiledBatch(id);
  if (!batch) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  return NextResponse.json(batch);
}
