import { NextRequest, NextResponse } from "next/server";
import { canConfirmFulfillmentLot, canPickFulfillmentLot, canPrintFulfillmentManifest, canViewFulfillmentRequests } from "@/lib/guards";
import { getCompiledLot } from "@/lib/fulfillmentGuides";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canViewFulfillmentRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const lot = await getCompiledLot(id);
  if (!lot) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  // Qué puede hacer quien mira — así la pantalla no necesita recibir
  // permisos nuevos desde arriba.
  return NextResponse.json({ ...lot, viewer: { canPrint: await canPrintFulfillmentManifest(), canPick: await canPickFulfillmentLot(), canConfirm: await canConfirmFulfillmentLot() } });
}
