import { NextRequest, NextResponse } from "next/server";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { getCarrierShippingStats } from "@/lib/purchases";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const points = await getCarrierShippingStats(id);
  return NextResponse.json({ points });
}
