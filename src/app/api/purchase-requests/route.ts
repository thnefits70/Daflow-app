import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests, canConfirmPurchaseReceiving, canRegisterPurchaseInvoices } from "@/lib/guards";
import { checkPurchaseSubmission, purchaseSubmissionSchema, nextPurchaseRequestNumber, purchaseRequestInclude } from "@/lib/purchases";
import { sendPushToOwner } from "@/lib/webPush";

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
    const pending = await prisma.purchaseRequest.findMany({
      where: { status: "PAID" },
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

  if (view === "invoicing") {
    if (!(await canRegisterPurchaseInvoices())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    const rows = await prisma.purchaseRequest.findMany({
      where: { status: { in: ["APPROVED", "PAID", "RECEIVED"] } },
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
    if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    const rows = await prisma.purchaseRequest.findMany({
      where: { status: "RECEIVED" },
      orderBy: { receipt: { confirmedAt: "desc" } },
      include: purchaseRequestInclude,
    });
    return NextResponse.json(rows);
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
          carrierId: d.shippingIncluded ? null : d.carrierId,
          shippingCostTotal: d.shippingIncluded ? null : check.lineShippingByIndex[idx] ?? null,
          shippingPaymentMethod: d.shippingIncluded ? null : d.shippingPaymentMethod,
          shippingPaymentTiming: d.shippingIncluded ? null : (d.shippingPaymentTiming ?? "WITH_PURCHASE"),
          carrierBankAccountId: d.shippingIncluded ? null : d.carrierBankAccountId || null,
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
