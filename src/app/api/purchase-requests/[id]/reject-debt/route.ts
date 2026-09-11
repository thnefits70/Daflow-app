import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnPurchaseApproval } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

const schema = z.object({ reason: z.string().trim().min(1, "Contá por qué no autorizaste esta compra.") });

// Confirmado 2026-09-11: si Bryan dice "yo no autoricé esto", queda excluido
// del saldo a pagar PARA SIEMPRE (nunca vuelve a aparecer en la cola ni en
// getSupplierDebtPendingItems) hasta que alguien lo resuelva a mano — el
// admin recibe aviso inmediato con el motivo para investigar con el
// proveedor.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canActOnPurchaseApproval())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const session = await auth();

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const existing = await prisma.purchaseRequest.findUnique({
    where: { id },
    include: { supplier: { select: { name: true, paymentMode: true } }, catalogItem: { select: { name: true } } },
  });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.supplier.paymentMode !== "CREDITO") return NextResponse.json({ error: "Esto no es una compra a un proveedor de crédito." }, { status: 409 });
  if (existing.status !== "RECEIVED") return NextResponse.json({ error: "Todavía no está recibida." }, { status: 409 });
  if (existing.buyerDebtConfirmedAt || existing.buyerDebtRejectedAt) return NextResponse.json({ error: "Ya fue resuelto." }, { status: 409 });

  const updated = await prisma.purchaseRequest.update({
    where: { id },
    data: { buyerDebtRejectedAt: new Date(), buyerDebtRejectedById: session!.user.id, buyerDebtRejectionReason: parsed.data.reason },
  });

  await notifyOwner("admin", {
    title: "⚠️ Mercadería recibida sin autorización de Bryan",
    body: `${existing.supplier.name} — ${existing.catalogItem.name}: "${parsed.data.reason}"`,
    url: "/admin",
  }).catch(() => null);

  return NextResponse.json(updated);
}
