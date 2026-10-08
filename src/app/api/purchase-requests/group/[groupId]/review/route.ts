import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { notifyOwner } from "@/lib/notifications";
import { releaseCreditsForGroup, getReservedCreditsForGroup, getAvailableCreditsForSupplier } from "@/lib/supplierCredits";
import { canActOnPurchaseApproval } from "@/lib/guards";
import { reviewApprovedPurchaseGroup, shippingFromSupplierTotal } from "@/lib/purchaseAi";
import { notifySupplierShippingTeamOfNewOrders } from "@/lib/supplierShippingPush";
import { cancelMarketProposal } from "@/lib/marketProposalCancel";
import { quoteTotalMatchesLines } from "@/lib/quoteMatch";

// cancelProposalCatalogItemIds: pedido del usuario 2026-10-03 (AM-0018) — al
// rechazar, Bryan marca qué productos nuevos de Análisis de Mercado "ya no
// van"; su propuesta se cancela en el mismo paso (ver marketProposalCancel).
const schema = z.object({
  action: z.enum(["approve", "reject"]),
  rejectReason: z.string().trim().optional(),
  cancelProposalCatalogItemIds: z.array(z.string()).optional(),
});

// Confirmado 2026-07-31: una cotización con varios productos se aprueba o
// rechaza COMO UNA SOLA compra — aplica a todas las filas del groupId a la
// vez, no producto por producto.
// Confirmado 2026-09-02: pedido explícito del usuario — corrección al
// diseño anterior. Aprobar/rechazar es EXCLUSIVO de quien tenga el permiso
// (hoy Bryan), ni siquiera admin — su parte activa pasó a ser pagar, no
// aprobar (ver canActOnPurchaseApproval en guards.ts).
// Confirmado 2026-09-03: EXCEPCIÓN a lo anterior — un grupo isEmergency
// (vía de respaldo cuando Jariel/Nairoby no están disponibles, ver
// canSubmitEmergencyPurchaseRequest) solo lo puede aprobar/rechazar el
// admin, nunca quien tenga el flag normal (hoy Bryan) — justamente porque
// Bryan podría ser quien la subió, y no debe poder aprobarse a sí mismo.
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const rows = await prisma.purchaseRequest.findMany({
    where: { groupId },
    include: {
      catalogItem: { select: { name: true, justCode: true } },
      supplier: { select: { name: true, paymentMode: true } },
      bankAccount: { select: { bankName: true, bankAccountType: true, bankAccountNumber: true, bankAccountHolder: true } },
    },
  });
  if (rows.length === 0) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (rows.some((r) => r.status !== "PENDING_APPROVAL")) return NextResponse.json({ error: "Ya fue revisada." }, { status: 409 });

  const isEmergencyGroup = rows.some((r) => r.isEmergency);
  const authorized = isEmergencyGroup ? session.user.role === "admin" : await canActOnPurchaseApproval();
  if (!authorized) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  // Confirmado 2026-09-02: pedido explícito del usuario — antes reviewedById
  // se dejaba siempre en null; ahora sí registra a quien aprobó de verdad
  // (Bryan) para que "Aprobada por X" en Mis solicitudes/Auditoría muestre a
  // la persona correcta. El admin (login "admin", sin fila real en User)
  // sigue guardando null, mismo patrón que paidById en pay/route.ts.
  // Confirmado 2026-10-08 (SC-170, Zheng Wu): no se aprueba si lo escrito no
  // cuadra con el total leído de la cotización (mismo criterio que al enviar,
  // ver lib/quoteMatch) — solo se puede rechazar para que la corrijan.
  if (parsed.data.action === "approve" && rows[0].supplier.paymentMode !== "CREDITO") {
    const reserved = await getReservedCreditsForGroup(groupId);
    const linesTotal = rows.reduce((s, r) => s + r.totalCost, 0);
    const ok = quoteTotalMatchesLines({
      readTotal: rows[0].quoteReadTotal,
      linesTotal,
      supplierShipping: shippingFromSupplierTotal(rows),
      appliedCreditTotal: reserved.reduce((s, c) => s + c.amount, 0),
    });
    if (!ok) {
      return NextResponse.json(
        { error: `No cuadra con la cotización (dice $${rows[0].quoteReadTotal?.toFixed(2) ?? "?"}, lo escrito suma $${linesTotal.toFixed(2)}) — recházala para que la corrijan.` },
        { status: 409 }
      );
    }
  }

  const isAdmin = session.user.role === "admin";
  const actorId = isAdmin ? null : session.user.id;
  await prisma.purchaseRequest.updateMany({
    where: { groupId },
    data:
      parsed.data.action === "approve"
        ? { status: "APPROVED", reviewedById: actorId, reviewedAt: new Date() }
        : { status: "REJECTED", rejectReason: parsed.data.rejectReason, reviewedById: actorId, reviewedAt: new Date() },
  });

  // Confirmado 2026-08-12: pedido explícito del usuario — si se rechaza por
  // completo, cualquier crédito reservado para esta solicitud vuelve a
  // quedar libre de inmediato.
  if (parsed.data.action === "reject") {
    await releaseCreditsForGroup(groupId);
  }

  // Solo productos de ESTA solicitud. Si una propuesta no se puede cancelar
  // (ej. otra compra viva del mismo producto), el rechazo igual queda hecho
  // y la propuesta sigue aprobada — se puede cancelar luego en Trazabilidad.
  if (parsed.data.action === "reject" && parsed.data.cancelProposalCatalogItemIds?.length) {
    const ids = parsed.data.cancelProposalCatalogItemIds.filter((id) => rows.some((r) => r.catalogItemId === id));
    const proposals = await prisma.marketProductProposal.findMany({ where: { catalogItemId: { in: ids }, status: "APPROVED" }, select: { id: true } });
    const reason = parsed.data.rejectReason || "Compra rechazada — el producto ya no va";
    for (const p of proposals) {
      await cancelMarketProposal({ proposalId: p.id, reason, actorUserId: actorId }).catch(() => null);
    }
  }

  const names = rows.map((r) => r.catalogItem.name).join(", ");

  const requestedById = rows[0].requestedById;
  if (requestedById) {
    await notifyOwner(requestedById, {
      title: parsed.data.action === "approve" ? "Solicitud aprobada" : "Solicitud rechazada",
      body: `${names} — ${parsed.data.action === "approve" ? "sigue con el pago" : parsed.data.rejectReason || "sin motivo especificado"}`,
      url: "/area/workspace",
    });
  }

  // Confirmado 2026-09-03: pedido explícito del usuario — avisar al admin
  // al instante cuando se aprueba (antes solo se enteraba por la tarjeta de
  // Inicio o, si nadie pagaba, por el aviso tardío de 24h en el cron).
  // Confirmado 2026-09-15: pedido explícito del usuario — un proveedor de
  // crédito (hoy solo CHEN) no se paga solicitud por solicitud (ver
  // group/[groupId]/pay/route.ts), se paga después por tanda en "Proveedores
  // con Crédito". Avisarle aquí sería un push que no le toca atender todavía,
  // así que solo se notifica cuando de verdad hay que transferirle al
  // proveedor ahora.
  if (parsed.data.action === "approve" && !isAdmin && rows[0].supplier.paymentMode !== "CREDITO") {
    const total = rows.reduce((sum, r) => sum + r.totalCost, 0);
    const totalLabel = total.toLocaleString("es-EC", { style: "currency", currency: "USD" });
    // Confirmado 2026-09-11: pedido explícito del usuario — el admin no
    // pertenece a ningún departamento (login sin deptId, ver
    // src/lib/periodicReminders.ts), así que "/area/workspace" lo mandaba a
    // /login. Debe abrir /admin/dept/<deptId> con la pestaña de Finanzas y
    // el groupId puestos, para caer directo en subir el comprobante de
    // ESTA solicitud (ver focusGroupId en PurchaseInvoicingPanel).
    await notifyOwner("admin", {
      title: "Solicitud de compra aprobada",
      body: `${names} — ${totalLabel} — lista para pagar`,
      url: `/admin/dept/${rows[0].deptId}?tab=compras&ptab=finanzas&group=${groupId}`,
    });
  }

  // Confirmado 2026-09-23, pedido explícito del usuario: si es un proveedor
  // de crédito (hoy CHEN), avisarle a su equipo de despacho (quienes
  // activaron avisos en el enlace "solo envíos") que hay un pedido nuevo.
  if (parsed.data.action === "approve" && rows[0].supplier.paymentMode === "CREDITO") {
    await notifySupplierShippingTeamOfNewOrders(
      rows[0].supplierId,
      rows.map((r) => ({ name: r.catalogItem.name, quantity: r.quantity }))
    );
  }

  // Confirmado 2026-09-04: pedido explícito del usuario (admin/Andrés) — en
  // cuanto se aprueba, la IA revisa de una sola vez toda la operación
  // (precios, crédito, documentos, cuenta bancaria) para que admin no tenga
  // que entrar a revisar cada solicitud a mano antes de pagar. Nunca bloquea
  // la aprobación en sí — si la IA falla, la solicitud queda igual aprobada,
  // simplemente sin resumen (se reintenta solo/a mano más adelante).
  if (parsed.data.action === "approve") {
    try {
      const r0 = rows[0];
      const [reservedCredits, availableCredits] = await Promise.all([
        getReservedCreditsForGroup(groupId),
        getAvailableCreditsForSupplier(r0.supplierId),
      ]);
      const review = await reviewApprovedPurchaseGroup({
        actorId,
        deptId: r0.deptId,
        supplierName: r0.supplier.name,
        requestNumber: r0.requestNumber,
        lines: rows.map((r) => ({
          name: r.catalogItem.name,
          justCode: r.catalogItem.justCode,
          quantity: r.quantity,
          unitCost: r.unitCost,
          totalCost: r.totalCost,
          justification: r.justification,
        })),
        totalCost: rows.reduce((s, r) => s + r.totalCost, 0),
        shippingFromSupplierTotal: shippingFromSupplierTotal(rows),
        quoteReadTotal: r0.quoteReadTotal,
        anyLineCodeOnly: rows.some((r) => !!r.quoteReferenceCode),
        bankAccount: r0.bankAccount,
        reservedCreditTotal: reservedCredits.reduce((s, c) => s + c.amount, 0),
        availableCreditTotal: availableCredits.reduce((s, c) => s + c.amount, 0),
        creditSkipJustification: r0.creditSkipJustification,
      });
      await prisma.purchaseRequest.updateMany({
        where: { groupId },
        data: { aiReviewSummary: review.summary, aiReviewOk: review.ok, aiReviewAt: new Date() },
      });
    } catch {
      // Sin bloquear — ver comentario arriba.
    }
  }

  const updated = await prisma.purchaseRequest.findMany({ where: { groupId } });
  return NextResponse.json(updated);
}
