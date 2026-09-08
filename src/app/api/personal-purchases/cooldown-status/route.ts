import { NextRequest, NextResponse } from "next/server";
import { canConfirmPersonalPurchaseInventory } from "@/lib/guards";
import { getCostCooldownStatus } from "@/lib/personalPurchases";

// Confirmado 2026-09-08 (pedido explícito del usuario): consulta de solo
// lectura para que Daniel vea, al confirmar el producto de bodega, si ese
// colaborador ya compró este mismo producto a precio de costo en los
// últimos 6 meses — antes era un cálculo silencioso, ahora se avisa.
export async function GET(req: NextRequest) {
  if (!(await canConfirmPersonalPurchaseInventory())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get("employeeId");
  const productName = searchParams.get("productName");
  if (!employeeId || !productName) return NextResponse.json({ error: "Faltan datos." }, { status: 400 });

  const status = await getCostCooldownStatus(employeeId, productName);
  return NextResponse.json(status);
}
