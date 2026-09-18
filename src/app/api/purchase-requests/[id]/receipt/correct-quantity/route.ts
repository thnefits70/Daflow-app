import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnPurchaseReceiving } from "@/lib/guards";

const schema = z.object({
  receivedQuantity: z.number().int().nonnegative(),
  note: z.string().trim().min(1, "Explica por qué se corrige la cantidad."),
});

// Confirmado 2026-09-08: pedido explícito de Daniel — la cantidad que el
// equipo declaró al recibir (PurchaseRequestReceipt.receivedQuantity) puede
// quedar desactualizada frente a lo que de verdad pasó (ej. resolvió un
// "Informar urgente" con Compras o internamente y ese número nunca se
// tocaba, dejando la alerta de "faltan X un." mostrando algo que ya no es
// cierto — ver resolve-internal/route.ts). Esta ruta corrige el número
// directo desde la tarjeta de "Aprobar recepción", solo mientras sigue en
// RECEIVED_PENDING_REVIEW (nunca después de aprobar, para no reescribir
// historia ya cerrada). Nota obligatoria + originalReceivedQuantity
// preserva lo primero que el equipo contó, para nunca perder ese dato.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseReceiving()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const existing = await prisma.purchaseRequest.findUnique({
    where: { id },
    select: {
      id: true,
      quantity: true,
      status: true,
      receipt: { select: { receivedQuantity: true, originalReceivedQuantity: true } },
      // Confirmado 2026-09-17: si hay excedente ya confirmado (ver
      // excess-confirm/route.ts), el tope de esta corrección también debe
      // incluirlo — igual que receipt/route.ts.
      urgentReports: { select: { excessQty: true, excessConfirmedAt: true } },
    },
  });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.status !== "RECEIVED_PENDING_REVIEW" || !existing.receipt) {
    return NextResponse.json({ error: "Solo se puede corregir mientras está pendiente de aprobación." }, { status: 409 });
  }
  const confirmedExcessQty = existing.urgentReports.reduce((s, r) => s + (r.excessConfirmedAt ? r.excessQty : 0), 0);
  const maxQty = existing.quantity + confirmedExcessQty;
  if (parsed.data.receivedQuantity > maxQty) {
    return NextResponse.json({ error: `No puede ser mayor a lo comprado (${maxQty} un.).` }, { status: 400 });
  }

  const isAdmin = session.user.role === "admin";
  const updated = await prisma.purchaseRequestReceipt.update({
    where: { requestId: id },
    data: {
      receivedQuantity: parsed.data.receivedQuantity,
      originalReceivedQuantity: existing.receipt.originalReceivedQuantity ?? existing.receipt.receivedQuantity,
      quantityCorrectedById: isAdmin ? null : session.user.id,
      quantityCorrectedAt: new Date(),
      quantityCorrectionNote: parsed.data.note,
    },
  });

  return NextResponse.json(updated);
}
