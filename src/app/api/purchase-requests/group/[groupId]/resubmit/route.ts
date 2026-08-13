import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { checkPurchaseSubmission, purchaseSubmissionSchema, purchaseRequestInclude } from "@/lib/purchases";
import { sendPushToOwner } from "@/lib/webPush";
import { reserveCreditsForGroup } from "@/lib/supplierCredits";

// Confirmado 2026-08-08: cambio de política pedido explícitamente por el
// usuario — "Corregir y reenviar" una solicitud rechazada antes creaba una
// solicitud NUEVA (nuevo groupId, nuevo código SC-XXX), encadenada por
// resubmittedFromGroupId. Eso hacía que el mismo pedido apareciera repetido
// varias veces en la lista (ej. SC-004/005/006 del mismo producto), lo cual
// retrasa el proceso. Ahora se corrige la MISMA solicitud en su lugar: se
// borran sus filas y se recrean con el MISMO groupId y el MISMO código
// SC-XXX, solo con attemptNumber incrementado ("2do intento", "3er
// intento"...) y vuelve a PENDING_APPROVAL. Nunca se puede resucitar algo
// que no esté REJECTED, ni que no sea de quien la pidió originalmente.
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await auth();
  if (!(await canSubmitPurchaseRequests()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = purchaseSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  const existingRows = await prisma.purchaseRequest.findMany({ where: { groupId } });
  if (existingRows.length === 0) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  const r0 = existingRows[0];
  if (r0.status !== "REJECTED") {
    return NextResponse.json({ error: "Solo se puede corregir una solicitud rechazada." }, { status: 409 });
  }

  const isAdmin = session.user.role === "admin";
  const owns = isAdmin ? r0.requestedById === null : r0.requestedById === session.user.id;
  if (!owns) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const check = await checkPurchaseSubmission(d);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  if (d.appliedCreditIds && d.appliedCreditIds.length > 0) {
    const reserveResult = await reserveCreditsForGroup({
      creditIds: d.appliedCreditIds,
      supplierId: d.supplierId,
      groupId,
      groupTotal: check.groupTotal,
    });
    if (!reserveResult.ok) return NextResponse.json({ error: reserveResult.error }, { status: reserveResult.status });
  }

  const attemptNumber = Math.max(...existingRows.map((r) => r.attemptNumber)) + 1;

  await prisma.$transaction([
    prisma.purchaseRequest.deleteMany({ where: { groupId } }),
    ...d.items.map((it, idx) =>
      prisma.purchaseRequest.create({
        data: {
          groupId,
          requestNumber: r0.requestNumber,
          deptId: r0.deptId,
          catalogItemId: it.catalogItemId,
          supplierId: d.supplierId,
          bankAccountId: check.resolvedBankAccountId,
          quantity: it.quantity,
          unitCost: it.unitCost,
          totalCost: it.quantity * it.unitCost,
          quoteImageUrl: d.quoteImageUrl,
          quoteReadTotal: d.quoteReadTotal,
          quoteReferenceCode: d.quoteReferenceCode || null,
          purchaseOrderUrl: d.purchaseOrderUrl || null,
          quoteConfirmedAt: new Date(),
          shippingIncluded: d.shippingIncluded,
          shippingCarrierPending: !d.shippingIncluded && !!d.shippingCarrierPending,
          carrierId: d.shippingIncluded || d.shippingCarrierPending ? null : d.carrierId,
          shippingCostTotal: d.shippingIncluded || d.shippingCarrierPending ? null : check.lineShippingByIndex[idx] ?? null,
          shippingPaymentMethod: d.shippingIncluded ? null : d.shippingPaymentMethod,
          shippingPaymentTiming: d.shippingIncluded ? null : (d.shippingCarrierPending ? "ON_DELIVERY" : (d.shippingPaymentTiming ?? "WITH_PURCHASE")),
          carrierBankAccountId: d.shippingIncluded || d.shippingCarrierPending ? null : d.carrierBankAccountId || null,
          justification: (check.anyOverThreshold || check.anySupplierNotCheapest) ? d.justification!.trim() : null,
          status: "PENDING_APPROVAL",
          requestedById: r0.requestedById,
          requestedByDeptId: r0.requestedByDeptId,
          attemptNumber,
          rejectReason: null,
        },
      })
    ),
  ]);

  const summary = d.items.length === 1 ? check.nameById.get(d.items[0].catalogItemId) : `${d.items.length} productos`;
  await sendPushToOwner("admin", {
    title: check.anyOverThreshold ? "🔴 Solicitud corregida — precio por encima del historial" : "Solicitud de compra corregida y reenviada",
    body: `${summary} · $${check.groupTotal.toFixed(2)} · intento ${attemptNumber}`,
    url: "/admin",
  }).catch(() => null);

  const full = await prisma.purchaseRequest.findMany({ where: { groupId }, include: purchaseRequestInclude });
  return NextResponse.json(full);
}
