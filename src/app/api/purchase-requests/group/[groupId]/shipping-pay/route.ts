import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canRegisterPurchaseInvoices } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";
import { findDuplicatePaymentProofUse, formatPurchaseRequestCode } from "@/lib/purchases";

const schema = z.object({
  proofUrl: z.string().url().nullable().optional(),
  proofReceiptNumber: z.string().trim().nullable().optional(),
});

// Confirmado 2026-08-03: registrar el pago del flete cuando quedó pendiente
// hasta la entrega — separado del pago del producto, que ya pasó antes.
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await auth();
  if (!(await canRegisterPurchaseInvoices()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const rows = await prisma.purchaseRequest.findMany({ where: { groupId }, include: { catalogItem: { select: { name: true } } } });
  if (rows.length === 0) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  const dup = await findDuplicatePaymentProofUse(parsed.data.proofReceiptNumber, groupId);
  if (dup) {
    return NextResponse.json(
      { error: `Ese comprobante ya se usó en otra solicitud (${dup.requestNumber ? formatPurchaseRequestCode(dup.requestNumber) : "otra operación"}) — no se puede reutilizar.` },
      { status: 409 }
    );
  }

  const isAdmin = session.user.role === "admin";
  const paidAt = new Date();
  await prisma.purchaseRequest.updateMany({
    where: { groupId },
    data: {
      shippingPaidAt: paidAt,
      shippingPaymentProofUrl: parsed.data.proofUrl || null,
      shippingPaymentProofReceiptNumber: parsed.data.proofReceiptNumber?.trim() || null,
      shippingPaidById: isAdmin ? null : session.user.id,
    },
  });

  const requestedById = rows[0].requestedById;
  if (requestedById) {
    const names = rows.map((r) => r.catalogItem.name).join(", ");
    await sendPushToOwner(requestedById, {
      title: "Flete pagado",
      body: `Ya se pagó el flete de ${names}`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  const updated = await prisma.purchaseRequest.findMany({ where: { groupId } });
  return NextResponse.json(updated);
}
