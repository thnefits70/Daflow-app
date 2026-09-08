import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canSetPersonalPurchasePrice } from "@/lib/guards";

// Confirmado 2026-09-08: pedido explícito del usuario — Nairoby se equivocó
// al fijar un precio y necesita corregirlo. Exclusivo de ella (misma regla
// que confirm-finance, sin bypass de admin). Solo permitido mientras el
// colaborador todavía no pagó nada (PENDING_PAYMENT_METHOD o
// PENDING_TRANSFER_PROOF, antes de subir comprobante o entregar efectivo) —
// pasado ese punto ya hubo movimiento de plata con el monto malo y esto deja
// de ser un simple "reabrir", pasa a ser un ajuste manual aparte.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canSetPersonalPurchasePrice())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const session = await auth();

  const order = await prisma.personalPurchaseOrder.findUnique({ where: { id }, select: { status: true } });
  if (!order) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (order.status !== "PENDING_PAYMENT_METHOD" && order.status !== "PENDING_TRANSFER_PROOF") {
    return NextResponse.json({ error: "Ya no se puede reabrir — el colaborador ya avanzó con el pago." }, { status: 409 });
  }

  const updated = await prisma.personalPurchaseOrder.update({
    where: { id },
    data: {
      status: "PENDING_FINANCE",
      paymentMethod: null,
      transferDeadlineAt: null,
      priceReopenedAt: new Date(),
      priceReopenedById: session!.user.id,
    },
  });

  return NextResponse.json(updated);
}
