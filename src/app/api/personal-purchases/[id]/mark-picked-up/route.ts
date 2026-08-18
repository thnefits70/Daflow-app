import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseInventory } from "@/lib/guards";

// Daniel marca cuando la persona físicamente se llevó el producto de
// bodega — solo informativo/trazabilidad, no afecta el cálculo del rol.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canConfirmPersonalPurchaseInventory())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const purchase = await prisma.personalPurchase.findUnique({ where: { id } });
  if (!purchase) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (purchase.status === "PENDING_INVENTORY") {
    return NextResponse.json({ error: "Todavía no confirmaste esta compra — no debería haber salido de bodega." }, { status: 409 });
  }

  const updated = await prisma.personalPurchase.update({ where: { id }, data: { pickedUpAt: new Date() } });
  return NextResponse.json(updated);
}
