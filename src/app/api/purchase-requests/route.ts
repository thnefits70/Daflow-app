import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { linkReadyToBuyProposalsToGroup } from "@/lib/marketProduct";
import { canSubmitPurchaseRequests, canViewOwnPurchaseHistory, canCreateNewPurchaseRequests, canSubmitEmergencyPurchaseRequest, canApprovePurchaseRequests, canConfirmPurchaseReceiving, canRegisterPurchaseInvoices, getPurchaseApproverIds } from "@/lib/guards";
import { checkRepurchaseApprovals, markRepurchaseReviewsUsed } from "@/lib/repurchaseReviews";
import { findItemsWithStockCover, isStockCoverBlockActive } from "@/lib/purchaseSuggestions";
import { checkPurchaseSubmission, purchaseSubmissionSchema, nextPurchaseRequestNumber, purchaseRequestInclude, findOpenPurchasesByOthers, lockAndFindOpenPurchaseByOthers, otherOpenPurchaseMessage, checkAndSaveFulfillmentSizes, formatPurchaseRequestCode } from "@/lib/purchases";
import { notifyOwner } from "@/lib/notifications";
import { reserveCreditsForGroup, releaseCreditsForGroup, getReservedCreditsForGroup, getAvailableCreditsForSupplier } from "@/lib/supplierCredits";
import { reviewApprovedPurchaseGroup, shippingFromSupplierTotal } from "@/lib/purchaseAi";

// Pedido del usuario 2026-10-01: a Jariel no le salían en "Mis solicitudes"
// las compras del mes pasado — los historiales tenían un tope fijo (50/100/40
// filas) y lo viejo simplemente desaparecía. Ahora no hay tope, pero tampoco
// se trae todo de una vez (con los años sería lento): se carga por páginas
// ("Ver más") y los filtros se aplican en el servidor, así que buscar algo
// viejo siempre lo encuentra aunque no esté en la primera página.
const HISTORY_PAGE_SIZE = 30;

function pageParams(req: NextRequest) {
  const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);
  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "", 10) || HISTORY_PAGE_SIZE));
  return { offset, limit };
}

function dateParam(req: NextRequest, name: string) {
  const v = req.nextUrl.searchParams.get(name);
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// Página por COMPRA (groupId), nunca por fila: una compra de varios productos
// son varias filas y no debe quedar partida entre dos páginas. Solo se leen
// los groupId (liviano); el include completo se pide únicamente para la página.
async function pagePurchaseGroups(where: Prisma.PurchaseRequestWhereInput, sortBy: "requestedAt" | "reviewedAt", offset: number, limit: number) {
  const groups =
    sortBy === "requestedAt"
      ? await prisma.purchaseRequest.groupBy({ by: ["groupId"], where, _max: { requestedAt: true }, orderBy: { _max: { requestedAt: "desc" } } })
      : await prisma.purchaseRequest.groupBy({ by: ["groupId"], where, _max: { reviewedAt: true }, orderBy: { _max: { reviewedAt: "desc" } } });
  const pageIds = groups.slice(offset, offset + limit).map((g) => g.groupId);
  const order = new Map(pageIds.map((id, i) => [id, i]));
  const rows =
    pageIds.length === 0
      ? []
      : await prisma.purchaseRequest.findMany({
          where: { AND: [where, { groupId: { in: pageIds } }] },
          orderBy: { requestedAt: "desc" },
          include: purchaseRequestInclude,
        });
  rows.sort((a, b) => order.get(a.groupId)! - order.get(b.groupId)!);
  return { rows, total: groups.length, hasMore: offset + limit < groups.length };
}

// status: "approval" (bandeja admin), "receiving" (Inventario), "invoicing"
// (Finanzas), "audit" (admin, historial de solo lectura), "mine" (lo que yo
// pedí) — cada rol ve solo su propia cola.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const view = req.nextUrl.searchParams.get("view") ?? "mine";

  if (view === "approval") {
    // Confirmado 2026-09-02: pedido explícito del usuario — además de admin,
    // quien tenga el nuevo permiso de aprobación con un clic (hoy Bryan) ve
    // esta misma bandeja (ver canApprovePurchaseRequests en guards.ts).
    if (session.user.role !== "admin" && !(await canApprovePurchaseRequests())) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    // Confirmado 2026-09-03: pedido explícito del usuario — una solicitud de
    // emergencia (isEmergency) nunca aparece en la bandeja de quien tenga
    // solo el permiso normal de aprobación (hoy Bryan, que además puede ser
    // quien la subió) — SOLO el admin la ve/gestiona acá, para que no exista
    // forma de que la misma persona se apruebe a sí misma.
    const isAdmin = session.user.role === "admin";
    const rows = await prisma.purchaseRequest.findMany({
      where: { status: "PENDING_APPROVAL", ...(isAdmin ? {} : { isEmergency: false }) },
      orderBy: { requestedAt: "asc" },
      include: purchaseRequestInclude,
    });
    return NextResponse.json(rows);
  }

  // Confirmado 2026-09-03: pedido explícito del usuario — Bryan notó que
  // apenas aprueba una solicitud, esta desaparece de la bandeja sin dejar
  // rastro visible ahí mismo. Mismo criterio de acceso que "approval"
  // (admin o canApprovePurchaseRequests); acá se ve TODO lo ya resuelto
  // (aprobado o rechazado), de solo lectura, más reciente primero — nunca
  // se puede volver a actuar sobre estas filas.
  if (view === "approval-history") {
    if (session.user.role !== "admin" && !(await canApprovePurchaseRequests())) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    const { offset, limit } = pageParams(req);
    const historyWhere: Prisma.PurchaseRequestWhereInput = { status: { in: ["APPROVED", "REJECTED", "PAID", "RECEIVED_PENDING_REVIEW", "RECEIVED"] } };
    // Pedido del usuario 2026-10-05 (Bryan): buscar una compra que aprobó por
    // producto (nombre o ID) o proveedor. Se filtra por COMPRA: si un producto
    // coincide, se muestra la compra completa con todos sus productos.
    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (q) {
      const matches = await prisma.purchaseRequest.findMany({
        where: {
          AND: [
            historyWhere,
            {
              OR: [
                { catalogItem: { name: { contains: q, mode: "insensitive" } } },
                { catalogItem: { justCode: { contains: q, mode: "insensitive" } } },
                { catalogItem: { code: { contains: q, mode: "insensitive" } } },
                { supplier: { name: { contains: q, mode: "insensitive" } } },
              ],
            },
          ],
        },
        select: { groupId: true },
        distinct: ["groupId"],
      });
      historyWhere.groupId = { in: matches.map((m) => m.groupId) };
    }
    return NextResponse.json(await pagePurchaseGroups(historyWhere, "reviewedAt", offset, limit));
  }

  if (view === "receiving") {
    if (!(await canConfirmPurchaseReceiving())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    // Confirmado 2026-08-18: pedido explícito del usuario — ahora incluye
    // RECEIVED_PENDING_REVIEW además de PAID, para que en la misma pestaña
    // el equipo vea lo que falta recibir y Daniel vea lo que ya recibieron y
    // está pendiente de su aprobación final.
    // Confirmado 2026-09-15, bug real reportado por el usuario: un proveedor
    // de crédito (hoy CHEN) nunca pasa por PAID antes de recibir — se recibe
    // primero, el pago real ocurre después agrupado en una tanda (ver
    // receipt/route.ts, isCreditSupplier). Sin esta rama, esta bandeja nunca
    // mostraba esos pedidos y Inventario no tenía dónde recibirlos.
    const pending = await prisma.purchaseRequest.findMany({
      where: {
        OR: [
          { status: { in: ["PAID", "RECEIVED_PENDING_REVIEW"] } },
          { status: "APPROVED", supplier: { paymentMode: "CREDITO" } },
        ],
      },
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
    // Stock por variante (2026-10-06): colores/tallas oficiales de cada
    // producto, para pedir cuántos llegaron de cada uno al recibir.
    const variants = await prisma.productVariant.findMany({
      where: { catalogItemId: { in: [...new Set(rows.map((r) => r.catalogItemId))] } },
      select: { catalogItemId: true, name: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(rows.map((r) => ({ ...r, variantNames: variants.filter((v) => v.catalogItemId === r.catalogItemId).map((v) => v.name) })));
  }

  // Confirmado 2026-08-25: mercadería ya RECIBIDA, para el bloque de
  // "Reclamo posterior al cierre" en la pestaña Inventario — lista liviana
  // (no purchaseRequestInclude completo, no hace falta info bancaria acá),
  // con los reclamos posteriores ya existentes de cada fila embebidos para
  // que el botón sepa si ya hay uno en curso.
  if (view === "received") {
    if (!(await canConfirmPurchaseReceiving())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    // Pedido del usuario 2026-10-01: antes solo las últimas 40 — ahora por
    // páginas, con búsqueda por nombre o ID para encontrar algo recibido hace
    // meses sin tener que pasar página por página.
    const { offset, limit } = pageParams(req);
    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    const rows = await prisma.purchaseRequest.findMany({
      where: {
        status: "RECEIVED",
        ...(q
          ? { catalogItem: { OR: [{ name: { contains: q, mode: "insensitive" } }, { justCode: { contains: q, mode: "insensitive" } }] } }
          : {}),
      },
      orderBy: [{ receipt: { confirmedAt: "desc" } }, { id: "desc" }],
      skip: offset,
      take: limit + 1,
      select: {
        id: true,
        requestNumber: true,
        quantity: true,
        unitCost: true,
        supplierId: true,
        catalogItem: { select: { id: true, name: true, photos: true, justCode: true, awaitingDropiId: true } },
        supplier: { select: { id: true, name: true } },
        receipt: { select: { confirmedAt: true } },
        urgentReports: {
          where: { isLateClaim: true },
          orderBy: { reportedAt: "desc" },
          select: { id: true, lateClaimCode: true, damagedQty: true, rejectedAt: true, reviewedByLeadAt: true, justConfirmedAt: true, reportedAt: true },
        },
      },
    });
    return NextResponse.json({ rows: rows.slice(0, limit), hasMore: rows.length > limit });
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

    // Confirmado 2026-09-04: pedido explícito del usuario (admin/Andrés) —
    // respaldo para operaciones que ya estaban APPROVED antes de que este
    // resumen existiera (o si la llamada al aprobar falló). Se rellena una
    // sola vez, de paso, para que "todo lo que ya me llega" venga con el
    // análisis sin depender de que alguien vuelva a aprobar.
    // AI_REVIEW_FIX_CUTOFF: corrección del mismo día — las primeras corridas
    // no le pasaban a la IA cuánto crédito había REALMENTE disponible, así
    // que marcaban como problema un crédito aplicado en 0 aunque nunca hubo
    // ninguno que aplicar (reportado por el usuario). Cualquier resumen
    // generado antes de este momento se vuelve a calcular una vez más.
    const AI_REVIEW_FIX_CUTOFF = new Date("2026-09-04T20:20:00Z");
    const pendingReviewGroupIds = [
      ...new Set(
        rows
          .filter((r) => r.status === "APPROVED" && (r.aiReviewSummary === null || (r.aiReviewAt && r.aiReviewAt < AI_REVIEW_FIX_CUTOFF)))
          .map((r) => r.groupId)
      ),
    ];
    if (pendingReviewGroupIds.length > 0) {
      await Promise.all(
        pendingReviewGroupIds.map(async (groupId) => {
          try {
            const groupRows = rows.filter((r) => r.groupId === groupId);
            const r0 = groupRows[0];
            const [reservedCredits, availableCredits] = await Promise.all([
              getReservedCreditsForGroup(groupId),
              getAvailableCreditsForSupplier(r0.supplierId),
            ]);
            const review = await reviewApprovedPurchaseGroup({
              actorId: r0.reviewedById,
              deptId: r0.deptId,
              supplierName: r0.supplier.name,
              requestNumber: r0.requestNumber,
              lines: groupRows.map((r) => ({
                name: r.catalogItem.name,
                justCode: r.catalogItem.justCode,
                quantity: r.quantity,
                unitCost: r.unitCost,
                totalCost: r.totalCost,
                justification: r.justification,
              })),
              totalCost: groupRows.reduce((s, r) => s + r.totalCost, 0),
              shippingFromSupplierTotal: shippingFromSupplierTotal(groupRows),
              quoteReadTotal: r0.quoteReadTotal,
              anyLineCodeOnly: groupRows.some((r) => !!r.quoteReferenceCode),
              bankAccount: r0.bankAccount,
              reservedCreditTotal: reservedCredits.reduce((s, c) => s + c.amount, 0),
              availableCreditTotal: availableCredits.reduce((s, c) => s + c.amount, 0),
              creditSkipJustification: r0.creditSkipJustification,
            });
            await prisma.purchaseRequest.updateMany({
              where: { groupId },
              data: { aiReviewSummary: review.summary, aiReviewOk: review.ok, aiReviewAt: new Date() },
            });
            for (const r of groupRows) {
              r.aiReviewSummary = review.summary;
              r.aiReviewOk = review.ok;
              r.aiReviewAt = new Date();
            }
          } catch {
            // Sin bloquear la carga de la pantalla — se reintenta en la próxima visita.
          }
        })
      );
    }

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
    // Fix 2026-09-09: pedido explícito del usuario — quien solo aprueba
    // (canApprovePurchaseRequests, hoy Bryan) ya no ve Auditoría. Se quita
    // ese permiso de acá y de la pestaña en PurchaseControlPanel para que
    // ambos lados sigan coincidiendo.
    const hasAuditAccess =
      (await canSubmitPurchaseRequests()) ||
      (await canConfirmPurchaseReceiving()) ||
      (await canRegisterPurchaseInvoices());
    if (!hasAuditAccess) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    // Confirmado 2026-08-13: pedido explícito del usuario — Auditoría
    // tampoco muestra una operación mientras Finanzas no la haya cerrado
    // (invoiceStatus sigue en PENDING), aunque Inventario ya haya confirmado
    // que llegó. Sigue viéndose en la bandeja de Finanzas hasta ese momento.
    // Ampliado 2026-09-28, pedido de Daniel ("poder ver todo lo que llegó"):
    // se devuelve TODO lo recibido, cada fila con pendingReasons (factura,
    // reporte urgente abierto, flete sin pagar). El panel decide con un
    // selector si muestra "Todo lo que llegó" o "Solo cerrado" (= el criterio
    // de siempre: pendingReasons vacío en todo el grupo).
    const rows = await prisma.purchaseRequest.findMany({
      where: { status: "RECEIVED" },
      orderBy: { receipt: { confirmedAt: "desc" } },
      include: purchaseRequestInclude,
    });
    const groupIdsPendingInvoice = new Set(rows.filter((r) => r.invoiceStatus === "PENDING").map((r) => r.groupId));
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
      rows.map((r) => ({
        ...r,
        pendingReasons: [
          ...(groupIdsPendingInvoice.has(r.groupId) ? ["Falta cierre de Finanzas"] : []),
          ...(groupIdsWithOpenReports.has(r.groupId) ? ["Reporte urgente abierto"] : []),
          ...(groupIdsWithPendingShipping.has(r.groupId) ? ["Flete sin pagar"] : []),
        ],
      }))
    );
  }

  // "mine" — lo que yo mismo pedí, para seguir el avance de mi solicitud.
  // Confirmado 2026-09-22: pedido explícito del usuario — canSubmitPurchaseRequests
  // ya no alcanza sola; quien perdió el permiso pero ya tiene historial propio
  // (ej. Bryan, tras pasar a liderar Marketing) conserva acceso de solo
  // lectura vía canViewOwnPurchaseHistory (ver guards.ts). El filtro por
  // requestedById de abajo no cambia, así que nunca ve solicitudes ajenas.
  if (!(await canViewOwnPurchaseHistory())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  // Pedido del usuario 2026-10-01: sin tope (con `take: 50` a Jariel ya no le
  // salían las compras del mes pasado) — por páginas, con los filtros de
  // proveedor y fechas aplicados acá para que encuentren cualquier compra.
  const isAdmin = session.user.role === "admin";
  const base: Prisma.PurchaseRequestWhereInput = isAdmin ? {} : { requestedById: session.user.id };
  const supplierId = req.nextUrl.searchParams.get("supplierId");
  const from = dateParam(req, "from");
  const to = dateParam(req, "to");
  const where: Prisma.PurchaseRequestWhereInput = {
    ...base,
    ...(supplierId ? { supplierId } : {}),
    ...(from || to ? { requestedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const { offset, limit } = pageParams(req);
  const [page, suppliers] = await Promise.all([
    pagePurchaseGroups(where, "requestedAt", offset, limit),
    // Lista completa de proveedores para el filtro (no solo los de la página).
    prisma.purchaseRequest.findMany({ where: base, distinct: ["supplierId"], select: { supplier: { select: { id: true, name: true } } } }),
  ]);
  return NextResponse.json({
    ...page,
    suppliers: suppliers.map((s) => s.supplier).sort((a, b) => a.name.localeCompare(b.name)),
  });
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
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  // Confirmado 2026-09-02: crear una solicitud NUEVA desde cero usa
  // canCreateNewPurchaseRequests (más estricto que canSubmitPurchaseRequests
  // — ver guards.ts) para poder bloquear puntualmente a alguien en
  // transición (hoy Bryan) sin tocarle el resto de "Mis solicitudes".
  // Confirmado 2026-09-03: pedido explícito del usuario — quien esté
  // bloqueado (hoy Bryan) puede igual crear una solicitud por la vía de
  // emergencia (canSubmitEmergencyPurchaseRequest), solo cuando Jariel y
  // Nairoby no están disponibles. isEmergency SIEMPRE lo decide el servidor
  // según qué permiso aplicó — nunca se confía en lo que mande el cliente,
  // para que nadie con acceso normal pueda marcarse a sí mismo como
  // "emergencia" y saltarse la bandeja de aprobación normal.
  const canNormal = await canCreateNewPurchaseRequests();
  let isEmergencySubmission = false;
  if (!canNormal) {
    if (!(await canSubmitEmergencyPurchaseRequest())) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    isEmergencySubmission = true;
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  if (isEmergencySubmission && !d.emergencyReason?.trim()) {
    return NextResponse.json({ error: "Escribe el motivo de la solicitud de emergencia (ej. \"Jariel no disponible\")." }, { status: 400 });
  }

  // Confirmado 2026-07-31: el bug real era este — el admin nunca tiene
  // session.user.deptId (su login no pertenece a un departamento), así que
  // antes esto rechazaba SIEMPRE con "No autorizado" aunque canSubmitPurchaseRequests()
  // ya hubiera dado luz verde. Para colaboradores se sigue usando su propio
  // departamento (nunca el que mande el cliente); solo el admin puede usar
  // el deptId explícito que manda el formulario.
  const isAdmin = session.user.role === "admin";
  const effectiveDeptId = session.user.deptId ?? (isAdmin ? d.deptId ?? null : null);
  if (!effectiveDeptId) {
    return NextResponse.json({ error: "No se pudo determinar el departamento de la solicitud — vuelve a intentarlo desde Control de Compras." }, { status: 400 });
  }

  // Confirmado 2026-09-29, pedido del usuario: nadie compra un producto que
  // otra persona ya está comprando (ej. Jariel y Nairoby sin saberlo). Solo
  // quien pidió la compra abierta puede pedir más; el admin no se frena.
  if (!isAdmin) {
    const others = await findOpenPurchasesByOthers(d.items.map((it) => it.catalogItemId), session.user.id);
    if (others.length > 0) return NextResponse.json({ error: otherOpenPurchaseMessage(others[0]) }, { status: 409 });
  }

  const check = await checkPurchaseSubmission(d);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  // Pedido del usuario 2026-10-06: toda recompra necesita su RC aprobada por
  // Bryan (ver repurchaseReviews.ts). El admin y la vía de emergencia no.
  let repurchaseReviewIds: string[] = [];
  if (!isAdmin && !isEmergencySubmission) {
    const rc = await checkRepurchaseApprovals({ lines: d.items, supplierId: d.supplierId, requesterId: session.user.id });
    if (!rc.ok) return NextResponse.json({ error: rc.error }, { status: 400 });
    repurchaseReviewIds = rc.reviewIds;
  }
  // Pedido del usuario 2026-10-07: la vía de emergencia no pasa por la RC de
  // Bryan, pero igual no se compra lo que todavía alcanza (pasado el conteo
  // físico; antes el stock no es confiable).
  if (!isAdmin && isEmergencySubmission && isStockCoverBlockActive()) {
    const [covered] = await findItemsWithStockCover(d.items.map((it) => it.catalogItemId));
    if (covered) return NextResponse.json({ error: covered.message }, { status: 409 });
  }
  // Pedido del usuario 2026-09-30: producto pequeño o normal (ver checkAndSaveFulfillmentSizes).
  const sizeError = await checkAndSaveFulfillmentSizes(d.items, session.user.role === "admin" ? null : session.user.id);
  if (sizeError) return NextResponse.json({ error: sizeError }, { status: 400 });

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
  // Pedido del usuario 2026-10-05: segundo chequeo con candado, por si dos
  // personas envían el mismo producto en el mismo segundo.
  const conflict = await prisma.$transaction(async (tx) => {
    const other = await lockAndFindOpenPurchaseByOthers(tx, d.items.map((it) => it.catalogItemId), isAdmin ? null : session.user.id);
    if (other) return other;
    await Promise.all(d.items.map((it, idx) =>
      tx.purchaseRequest.create({
        data: {
          groupId,
          requestNumber,
          deptId: effectiveDeptId,
          catalogItemId: it.catalogItemId,
          supplierId: d.supplierId,
          bankAccountId: check.resolvedBankAccountId,
          quantity: it.quantity,
          unitCost: it.unitCost,
          totalCost: Math.round(it.quantity * it.unitCost * 100) / 100,
          quoteImageUrl: d.quoteImageUrl,
          quoteReadTotal: d.quoteReadTotal,
          quoteReferenceCode: it.quoteReferenceCode || null,
          quoteConfirmedAt: new Date(),
          shippingIncluded: d.shippingIncluded,
          shippingCarrierPending: !d.shippingIncluded && !!d.shippingCarrierPending,
          carrierId: d.shippingIncluded || d.shippingCarrierPending ? null : d.carrierId,
          shippingCostTotal: d.shippingIncluded || d.shippingCarrierPending ? null : check.lineShippingByIndex[idx] ?? null,
          shippingPaymentMethod: d.shippingIncluded ? null : d.shippingPaymentMethod,
          shippingPaymentTiming: d.shippingIncluded ? null : (d.shippingCarrierPending ? "ON_DELIVERY" : (d.shippingPaymentTiming ?? "WITH_PURCHASE")),
          carrierBankAccountId: d.shippingIncluded || d.shippingCarrierPending ? null : d.carrierBankAccountId || null,
          justification: check.justificationByIndex[idx],
          creditSkipJustification: check.creditSkipJustification,
          status: "PENDING_APPROVAL",
          requestedById: isAdmin ? null : session.user.id,
          requestedByDeptId: effectiveDeptId,
          isEmergency: isEmergencySubmission,
          emergencyReason: isEmergencySubmission ? d.emergencyReason!.trim() : null,
          marketProductProposalId: d.marketProductProposalId || null,
        },
      })
    ));
    await markRepurchaseReviewsUsed(tx, repurchaseReviewIds, groupId);
    return null;
  }, { timeout: 20000, maxWait: 10000 });
  if (conflict) {
    await releaseCreditsForGroup(groupId);
    return NextResponse.json({ error: otherOpenPurchaseMessage(conflict) }, { status: 409 });
  }

  await linkReadyToBuyProposalsToGroup(groupId);

  // Pedido del usuario 2026-09-30 (Bryan, casco SC-124): se puede comprar un
  // producto nuevo antes de que exista en Dropi, pero Heidy tiene que
  // enterarse en el momento para publicarlo antes de que llegue a bodega.
  const unpublished = await prisma.purchaseCatalogItem.findMany({
    where: { id: { in: d.items.map((it) => it.catalogItemId) }, awaitingDropiId: true },
    select: { name: true },
  });
  if (unpublished.length > 0) {
    const publishers = await prisma.user.findMany({ where: { canPublishMarketProduct: true, isActive: true }, select: { id: true } });
    await Promise.all(
      publishers.map((u) =>
        notifyOwner(u.id, {
          title: "Ya se está comprando — publícalo en Dropi",
          body: `${unpublished.map((c) => c.name).join(", ")} (${formatPurchaseRequestCode(requestNumber)}). Súbelo a Dropi primero, antes de que llegue a bodega.`,
          url: "/area/workspace?tab=analisis-mercado&ptab=publicar",
        }).catch(() => null)
      )
    );
  }

  const summary = d.items.length === 1 ? check.nameById.get(d.items[0].catalogItemId) : `${d.items.length} productos`;

  // Confirmado 2026-09-03: pedido explícito del usuario — cuando se usa la
  // vía de emergencia, el aviso al admin debe dejar claro que se usó esa
  // opción y por qué, y NADIE más se notifica (ni los aprobadores normales,
  // hoy Bryan, que sería la misma persona que la subió) — solo el admin
  // puede actuar sobre esto, ver GET view=approval y review/route.ts.
  if (isEmergencySubmission) {
    await notifyOwner("admin", {
      title: "🚨 Solicitud de emergencia de compra",
      body: `${summary} · $${check.groupTotal.toFixed(2)} — motivo: ${d.emergencyReason!.trim()}`,
      url: "/admin",
    });

    const full = await prisma.purchaseRequest.findMany({ where: { groupId }, include: purchaseRequestInclude });
    return NextResponse.json(full, { status: 201 });
  }

  // Confirmado 2026-09-15: pedido explícito del usuario — el admin ya NO se
  // notifica al crearse la solicitud (eso solo le toca a quien aprueba, hoy
  // Bryan). El admin se entera recién cuando ya está aprobada y lista para
  // pagar (ver review/route.ts), para no recibir un push por cada solicitud
  // que ni siquiera va a pagar todavía.
  // Confirmado 2026-09-02: pedido explícito del usuario — se avisa a quien
  // tenga el nuevo permiso de aprobación con un clic (hoy Bryan), para que
  // sepa que hay algo suyo por aprobar.
  const approverIds = await getPurchaseApproverIds();
  await Promise.all(
    approverIds.map((id) =>
      notifyOwner(id, {
        title: check.anyOverThreshold ? "🔴 Nueva solicitud — precio por encima del historial" : "Nueva solicitud de compra",
        body: `${summary} · $${check.groupTotal.toFixed(2)}`,
        url: "/area/workspace",
      })
    )
  );

  const full = await prisma.purchaseRequest.findMany({ where: { groupId }, include: purchaseRequestInclude });
  return NextResponse.json(full, { status: 201 });
}
