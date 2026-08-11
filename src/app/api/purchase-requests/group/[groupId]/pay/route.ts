import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canRegisterPurchaseInvoices } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";
import { findDuplicatePaymentProofUse, formatPurchaseRequestCode } from "@/lib/purchases";

// Confirmado 2026-08-06: si el crédito disponible con el proveedor cubre
// TODO lo que corresponde pagar, no hay transferencia real que respaldar
// con un comprobante — por eso paymentProofUrl es opcional cuando se aplica
// crédito, pero sigue siendo obligatorio si queda algo por transferir.
const schema = z.object({
  paymentProofUrl: z.string().url().optional(),
  appliedCreditIds: z.array(z.string()).optional(),
  // Confirmado 2026-08-11: leído por la IA al verificar el comprobante en el
  // cliente — se manda tal cual (mismo patrón que aiPhotoMatch en receipt/
  // route.ts), nunca se re-lee server-side.
  paymentProofReceiptNumber: z.string().trim().nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await auth();
  if (!(await canRegisterPurchaseInvoices()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const rows = await prisma.purchaseRequest.findMany({ where: { groupId }, include: { catalogItem: { select: { name: true } } } });
  if (rows.length === 0) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (rows.some((r) => r.status !== "APPROVED")) {
    return NextResponse.json({ error: "Solo se puede pagar una solicitud ya aprobada." }, { status: 409 });
  }

  const appliedCreditIds = parsed.data.appliedCreditIds ?? [];
  let appliedTotal = 0;
  if (appliedCreditIds.length > 0) {
    const credits = await prisma.supplierCredit.findMany({ where: { id: { in: appliedCreditIds }, supplierId: rows[0].supplierId, status: "AVAILABLE" } });
    if (credits.length !== appliedCreditIds.length) {
      return NextResponse.json({ error: "Uno o más créditos ya no están disponibles." }, { status: 409 });
    }
    appliedTotal = credits.reduce((s, c) => s + c.amount, 0);
  }

  const total = rows.reduce((s, r) => s + r.totalCost, 0);
  const netAmount = Math.max(0, total - appliedTotal);
  if (netAmount > 0 && !parsed.data.paymentProofUrl) {
    return NextResponse.json({ error: "Falta el comprobante de lo que se transfirió." }, { status: 400 });
  }

  const dup = await findDuplicatePaymentProofUse(parsed.data.paymentProofReceiptNumber, groupId);
  if (dup) {
    return NextResponse.json(
      { error: `Ese comprobante ya se usó en otra solicitud (${dup.requestNumber ? formatPurchaseRequestCode(dup.requestNumber) : "otra operación"}) — no se puede reutilizar.` },
      { status: 409 }
    );
  }

  const isAdmin = session.user.role === "admin";
  const paidAt = new Date();
  await prisma.$transaction([
    prisma.purchaseRequest.updateMany({
      where: { groupId },
      data: {
        status: "PAID",
        paidAt,
        paymentProofUrl: parsed.data.paymentProofUrl ?? null,
        paymentProofReceiptNumber: parsed.data.paymentProofReceiptNumber?.trim() || null,
        paidById: isAdmin ? null : session.user.id,
      },
    }),
    ...(appliedCreditIds.length > 0
      ? [prisma.supplierCredit.updateMany({
          where: { id: { in: appliedCreditIds } },
          data: { status: "APPLIED", appliedToGroupId: groupId, appliedAt: paidAt },
        })]
      : []),
  ]);

  const inventarioLeader = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "INV" } }, select: { id: true } });
  const requestedById = rows[0].requestedById;
  const names = rows.map((r) => r.catalogItem.name).join(", ");
  const notifyTargets = new Set<string>(["admin"]);
  if (inventarioLeader) notifyTargets.add(inventarioLeader.id);
  if (requestedById) notifyTargets.add(requestedById);

  await Promise.all(
    [...notifyTargets].map((ownerId) =>
      sendPushToOwner(ownerId, {
        title: ownerId === requestedById ? "Tu solicitud ya fue pagada" : "Mercadería pagada — en camino",
        body: names,
        url: ownerId === inventarioLeader?.id || ownerId === requestedById ? "/area/workspace" : "/admin",
      }).catch(() => null)
    )
  );

  const updated = await prisma.purchaseRequest.findMany({ where: { groupId } });
  return NextResponse.json(updated);
}
