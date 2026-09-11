import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnPurchaseApproval } from "@/lib/guards";

// Confirmado 2026-09-11: exclusivo de quien aprueba compras de verdad (hoy
// Bryan, canActOnPurchaseApproval) — ni siquiera admin, mismo patrón que
// aprobar/rechazar la solicitud original. Confirma que él sí autorizó esta
// compra a un proveedor de crédito; recién con esto entra al saldo a pagar
// (ver getSupplierDebtPendingItems en src/lib/supplierDebt.ts).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canActOnPurchaseApproval())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const session = await auth();

  const { id } = await params;
  const existing = await prisma.purchaseRequest.findUnique({
    where: { id },
    include: { supplier: { select: { paymentMode: true } } },
  });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.supplier.paymentMode !== "CREDITO") return NextResponse.json({ error: "Esto no es una compra a un proveedor de crédito." }, { status: 409 });
  if (existing.status !== "RECEIVED") return NextResponse.json({ error: "Todavía no está recibida." }, { status: 409 });
  if (existing.buyerDebtConfirmedAt || existing.buyerDebtRejectedAt) return NextResponse.json({ error: "Ya fue resuelto." }, { status: 409 });

  const updated = await prisma.purchaseRequest.update({
    where: { id },
    data: { buyerDebtConfirmedAt: new Date(), buyerDebtConfirmedById: session!.user.id },
  });

  return NextResponse.json(updated);
}
