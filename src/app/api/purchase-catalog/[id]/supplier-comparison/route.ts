import { NextRequest, NextResponse } from "next/server";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { getCatalogItemSupplierComparison } from "@/lib/purchases";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const suppliers = await getCatalogItemSupplierComparison(id);
  return NextResponse.json(suppliers);
}
