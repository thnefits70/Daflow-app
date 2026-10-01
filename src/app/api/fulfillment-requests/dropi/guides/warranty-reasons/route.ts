import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canSubmitFulfillmentRequest } from "@/lib/guards";

// Pedido del usuario 2026-09-30: al subir las guías, Yair elige el motivo de
// cada garantía — los mismos motivos del KPI de Garantías (WarrantyCategory).
// Solo lectura; un motivo nuevo se crea al guardar las guías.
export async function GET() {
  if (!(await canSubmitFulfillmentRequest())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const categories = await prisma.warrantyCategory.findMany({ orderBy: { name: "asc" }, select: { name: true } });
  return NextResponse.json({ reasons: categories.map((c) => c.name) });
}
