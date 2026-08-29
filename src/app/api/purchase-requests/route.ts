import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests, canConfirmPurchaseReceiving, canRegisterPurchaseInvoices } from "@/lib/guards";
import { checkPurchaseSubmission, purchaseSubmissionSchema, nextPurchaseRequestNumber, purchaseRequestInclude } from "@/lib/purchases";
import { sendPushToOwner } from "@/lib/webPush";
import { reserveCreditsForGroup } from "@/lib/supplierCredits";

// status: "approval" (bandeja admin), "receiving" (Inventario), "invoicing"
// (Finanzas), "audit" (admin, historial de solo lectura), "mine" (lo que yo
// pedí) — cada rol ve solo su propia cola.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const view = req.nextUrl.searchParams.get("view") ?? "mine";

  if (view === "approval") {
    if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    const rows = await prisma.purchaseRequest.findMany({
      where: { status: "PENDING_APPROVAL" },
      orderBy: { requestedAt: "asc" },
      include: purchaseRequestInclude,
    });
    return NextResponse.json(rows);
  }

  if (view === "receiving") {
    if (!(await canConfirmPurchaseReceiving())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    // Confirmado 2026-08-18: pedido explícito del usuario — ahora incluye
    // RECEIVED_PENDING_REVIEW además de PAID, para que en la misma pestaña
    // el equipo vea lo que falta recibir y Daniel vea lo que ya recibieron y
    // está pendiente de su aprobación final.
    const pending = await prisma.purchaseRequest.findMany({
      where: { status: { in: ["PAID", "RECEIVED_PENDING_REVIEW"] } },
      select: { groupId: true },
      orderBy: { paidAt: "asc" },
    });
    // Confirmado 2026-07-31: Inventario necesita ver el grupo completo (no
    // solo lo que falta) para declarar qué productos de una misma cotización
    // ya llegaron y cuáles todavía se esperan — el grupo desaparece de esta
    // bandeja solo cuando TODAS sus filas pasan a RECEIVED.
    const groupIds = [...new Set(pending.map((r) => r.groupId))];
    if (groupIds.length === 0) return NextResponse.json([]);
    const rows = await prisma.purchaseRequest.findMany({
      where: { groupId: { in: groupIds } },
      orderBy: { requestedAt: "asc" },
      include: purchaseRequestInclude,
    });
    return NextResponse.json(rows);
  }

  // Confirmado 2026-08-25: mercadería ya RECIBIDA, para el bloque de
  // "Reclamo posterior al cierre" en la pestaña Inventario — lista liviana
  // (no purchaseRequestInclude completo, no hace falta info bancaria acá),
  // con los reclamos posteriores ya existentes de cada fila embebidos para
  // que el botón sepa si ya hay uno en curso.
  if (view === "received") {
    if (!(await canConfirmPurchaseReceiving())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    const rows = await prisma.purchaseRequest.findMany({
      where: { status: "RECEIVED" },
      orderBy: { receipt: { confirmedAt: "desc" } },
      take: 40,
      select: {
        id: true,
        requestNumber: true,
        quantity: true,
        unitCost: true,
        supplierId: true,
        catalogItem: { select: { id: true, name: true, photos: true, justCode: true } },
        supplier: { select: { id: true, name: true } },
        receipt: { select: { confirmedAt: true } },
        urgentReports: {
          where: { isLateClaim: true },
          orderBy: { reportedAt: "desc" },
          select: { id: true, lateClaimCode: true, damagedQty: true, rejectedAt: true, reviewedByLeadAt: true, justConfirmedAt: true, reportedAt: true },
        },
      },
    });
    return NextResponse.json(rows);
  }

  if (view === "invoicing") {
    if (!(await canRegisterPurchaseInvoices())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    // Confirmado 2026-08-18: RECEIVED_PENDING_REVIEW se agrega para que
    // Finanzas no pierda de vista la operación mientras está en el limbo
    // entre PAID y RECEIVED (esperando que Daniel apruebe la recepción del
    // equipo).
    const rows = await prisma.purchaseRequest.findMany({
      where: { status: { in: ["APPROVED", "PAID", "RECEIVED_PENDING_REVIEW", "RECEIVED"] } },
      orderBy: [{ status: "asc" }, { requestedAt: "desc" }],
      include: purchaseRequestInclude,
    });
    return NextResponse.json(rows);
  }

  // Confirmado 2026-08-08: "Auditoría" — historial completo de todo lo que
  // ya se confirmó recibido en bodega, exclusivo del admin, puramente de
  // solo lectura (ninguna acción se hace desde esta vista). Se ordena por
  // fecha de confirmación de recepción, la más reciente primero.
  if (view === "audit") {
    // Confirmado 2026-08-12: pedido explícito del usuario — ya no exclusivo
    // de admin. Bryan (Solicitar), Daniel (Inventario) y Nairoby (Finanzas)
    // también ven Auditoría, siempre de solo lectura — cada uno ya tiene
    // acceso de escritura a su propia parte de este mismo historial, esto
    // solo les da la vista completa de las transacciones ya registradas.
    const hasAuditAccess =
      (await canSubmitPurchaseRequests()) || (await canConfirmPurchaseReceiving()) || (await canRegisterPurchaseInvoices());
    if (!hasAuditAccess) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    // Confirmado 2026-08-13: pedido explícito del usuario — Auditoría
    // tampoco muestra una operación mientras Finanzas no la haya cerrado
    // (invoiceStatus sigue en PENDING), aunque Inventario ya haya confirmado
    // que llegó. Sigue viéndose en la bandeja de Finanzas hasta ese momento.
    const rows = await prisma.purchaseRequest.findMany({
      where: { status: "RECEIVED", invoiceStatus: { not: "PENDING" } },
      orderBy: { receipt: { confirmedAt: "desc" } },
      include: purchaseRequestInclude,
    });
    // Confirmado 2026-08-12: pedido explícito del usuario — Auditoría es
    // "todo ya saneado", nunca algo que siga pendiente. Si CUALQUIER
    // producto de la cotización tiene un reporte urgente sin resolver del
    // todo (suma de resoluciones COMPLETED < total reportado), se excluye
    // la operación COMPLETA hasta que quede resuelta con el proveedor
    // (reemplazo, reembolso/crédito o pérdida) — recién ahí pasa a verse acá.
    const groupIdsWithOpenReports = new Set(
      rows
        .filter((r) =>
          r.urgentReports.some((rep) => {
            const total = rep.damagedQty + rep.missingQty + rep.incompleteQty + rep.differentQty;
            const completed = rep.resolutions.filter((res) => res.status === "COMPLETED").reduce((s, res) => s + res.quantity, 0);
            return completed < total;
          })
        )
        .map((r) => r.groupId)
    );
    // Confirmado 2026-08-13: pedido explícito del usuario — un flete que
    // todavía no se pagó (cobro aparte, diferido hasta la entrega) también
    // cuenta como "algo pendiente" — se excluye la operación completa hasta
    // que quede pagado, mismo criterio que ya aplica a factura y reportes
    // urgentes. El flete incluido en el precio, o pagado junto con la
    // compra (WITH_PURCHASE, ya resuelto en el pago inicial), nunca bloquea.
    const groupIdsWithPendingShipping = new Set(
      rows
        .filter((r) => !r.shippingIncluded && r.shippingPaymentTiming === "ON_DELIVERY" && !r.shippingPaidAt)
        .map((r) => r.groupId)
    );
    return NextResponse.json(
      rows.filter((r) => !groupIdsWithOpenReports.has(r.groupId) && !groupIdsWithPendingShipping.has(r.groupId))
    );
  }

  // "mine" — lo que yo mismo pedí, para seguir el avance de mi solicitud.
  if (!(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const isAdmin = session.user.role === "admin";
  const rows = await prisma.purchaseRequest.findMany({
    where: isAdmin ? {} : { requestedById: session.user.id },
    orderBy: { requestedAt: "desc" },
    include: purchaseRequestInclude,
    take: 50,
  });

  return NextResponse.json(rows);
}

// Confirmado 2026-07-31: una cotización suele traer varios productos — se
// manda un arreglo `items`, todos comparten proveedor/cotización/envío, y se
// crea una fila PurchaseRequest POR PRODUCTO (conserva intacta toda la
// lógica de historial de precio/umbral por insumo), todas con el mismo
// groupId para que se vean, aprueben y paguen como una sola compra.
const createSchema = purchaseSubmissionSchema.extend({
  // El admin no pertenece a ningún departamento (login sin deptId) — cuando
  // solicita desde la pestaña de compras de una página de departamento
  // (siempre "Control de Compras"), el cliente manda ESE id explícito.
  deptId: z.string().min(1).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canSubmitPurchaseRequests()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  // Confirmado 2026-07-31: el bug real era este — el admin nunca tiene
  // session.user.deptId (su login no pertenece a un departamento), así que
  // antes esto rechazaba SIEMPRE con "No autorizado" aunque canSubmitPurchaseRequests()
  // ya hubiera dado luz verde. Para empleados se sigue usando su propio
  // departamento (nunca el que mande el cliente); solo el admin puede usar
  // el deptId explícito que manda el formulario.
  const isAdmin = session.user.role === "admin";
  const effectiveDeptId = session.user.deptId ?? (isAdmin ? d.deptId ?? null : null);
  if (!effectiveDeptId) {
    return NextResponse.json({ error: "No se pudo determinar el departamento de la solicitud — vuelve a intentarlo desde Control de Compras." }, { status: 400 });
  }

  const check = await checkPurchaseSubmission(d);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const groupId = randomUUID();

  // Confirmado 2026-08-12: pedido explícito del usuario — se reservan ANTES
  // de crear la solicitud; si algo no cuadra (crédito ya usado, o supera el
  // total de esta solicitud), se corta acá y no se crea nada.
  if (d.appliedCreditIds && d.appliedCreditIds.length > 0) {
    const reserveResult = await reserveCreditsForGroup({
      creditIds: d.appliedCreditIds,
      supplierId: d.supplierId,
      groupId,
      groupTotal: check.groupTotal,
    });
    if (!reserveResult.ok) return NextResponse.json({ error: reserveResult.error }, { status: reserveResult.status });
  }

  const requestNumber = await nextPurchaseRequestNumber();
  await prisma.$transaction(
    d.items.map((it, idx) =>
      prisma.purchaseRequest.create({
        data: {
          groupId,
          requestNumber,
          deptId: effectiveDeptId,
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
          requestedById: isAdmin ? null : session.user.id,
          requestedByDeptId: effectiveDeptId,
        },
      })
    )
  );

  // Confirmado 2026-07-30: push en tiempo real al admin, aparte de la
  // notificación diaria de Pendientes — apenas se envía la solicitud.
  const summary = d.items.length === 1 ? check.nameById.get(d.items[0].catalogItemId) : `${d.items.length} productos`;
  await sendPushToOwner("admin", {
    title: check.anyOverThreshold ? "🔴 Nueva solicitud — precio por encima del historial" : "Nueva solicitud de compra",
    body: `${summary} · $${check.groupTotal.toFixed(2)}`,
    url: "/admin",
  }).catch(() => null);

  const full = await prisma.purchaseRequest.findMany({ where: { groupId }, include: purchaseRequestInclude });
  return NextResponse.json(full, { status: 201 });
}
