import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests, canConfirmPurchaseReceiving, canRegisterPurchaseInvoices } from "@/lib/guards";
import { effectiveUnitCost, getCatalogItemPriceStats } from "@/lib/purchases";
import { sendPushToOwner } from "@/lib/webPush";

const requestInclude = {
  catalogItem: { select: { id: true, name: true, photos: true } },
  supplier: { select: { id: true, name: true, bankName: true, bankAccountType: true, bankAccountNumber: true, bankAccountHolder: true } },
  carrier: { select: { id: true, name: true, bankName: true, bankAccountType: true, bankAccountNumber: true, bankAccountHolder: true } },
  requestedBy: { select: { name: true } },
  reviewedBy: { select: { name: true } },
  receipt: true,
  urgentReports: { orderBy: { reportedAt: "desc" as const } },
};

// status: "approval" (bandeja admin), "receiving" (Inventario), "invoicing"
// (Finanzas), "mine" (lo que yo pedí) — cada rol ve solo su propia cola.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const view = req.nextUrl.searchParams.get("view") ?? "mine";

  if (view === "approval") {
    if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    const rows = await prisma.purchaseRequest.findMany({
      where: { status: "PENDING_APPROVAL" },
      orderBy: { requestedAt: "asc" },
      include: requestInclude,
    });
    return NextResponse.json(rows);
  }

  if (view === "receiving") {
    if (!(await canConfirmPurchaseReceiving())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    const rows = await prisma.purchaseRequest.findMany({
      where: { status: "PAID" },
      orderBy: { paidAt: "asc" },
      include: requestInclude,
    });
    return NextResponse.json(rows);
  }

  if (view === "invoicing") {
    if (!(await canRegisterPurchaseInvoices())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    const rows = await prisma.purchaseRequest.findMany({
      where: { status: { in: ["APPROVED", "PAID", "RECEIVED"] } },
      orderBy: [{ status: "asc" }, { requestedAt: "desc" }],
      include: requestInclude,
    });
    return NextResponse.json(rows);
  }

  // "mine" — lo que yo mismo pedí, para seguir el avance de mi solicitud.
  if (!(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const isAdmin = session.user.role === "admin";
  const rows = await prisma.purchaseRequest.findMany({
    where: isAdmin ? {} : { requestedById: session.user.id },
    orderBy: { requestedAt: "desc" },
    include: requestInclude,
    take: 50,
  });
  return NextResponse.json(rows);
}

// Confirmado 2026-07-31: una cotización suele traer varios productos — se
// manda un arreglo `items`, todos comparten proveedor/cotización/envío, y se
// crea una fila PurchaseRequest POR PRODUCTO (conserva intacta toda la
// lógica de historial de precio/umbral por insumo), todas con el mismo
// groupId para que se vean, aprueben y paguen como una sola compra.
const lineSchema = z.object({
  catalogItemId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitCost: z.number().positive(),
});

const createSchema = z.object({
  items: z.array(lineSchema).min(1, "Agrega al menos un producto."),
  supplierId: z.string().min(1),
  quoteImageUrl: z.string().url(),
  quoteReadTotal: z.number().nullable(),
  quoteReferenceCode: z.string().trim().nullable().optional(),
  shippingIncluded: z.boolean(),
  carrierId: z.string().min(1).nullable().optional(),
  shippingCostTotal: z.number().nonnegative().nullable().optional(),
  shippingPaymentMethod: z.enum(["TRANSFER", "PETTY_CASH"]).nullable().optional(),
  justification: z.string().trim().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canSubmitPurchaseRequests()) || !session || !session.user.deptId) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  if (!d.shippingIncluded && !d.carrierId) {
    return NextResponse.json({ error: "Falta el transportista, ya que el envío no está incluido." }, { status: 400 });
  }

  const groupTotal = d.items.reduce((sum, it) => sum + it.quantity * it.unitCost, 0);
  const matches = d.quoteReadTotal !== null && Math.abs(d.quoteReadTotal - groupTotal) < 0.01;
  const manuallyConfirmed = !!d.quoteReferenceCode;
  if (!matches && !manuallyConfirmed) {
    return NextResponse.json({ error: "La cotización no coincide con lo escrito — verifícala de nuevo antes de enviar." }, { status: 400 });
  }

  // El envío se reparte proporcionalmente entre las líneas por cantidad,
  // para que el costo efectivo por unidad de CADA producto siga incluyendo
  // su parte del flete al compararlo contra su propio historial.
  const totalQty = d.items.reduce((s, it) => s + it.quantity, 0);

  let anyOverThreshold = false;
  const lineChecks: { catalogItemName: string; effCost: number; last3Avg: number }[] = [];
  for (const it of d.items) {
    const stats = await getCatalogItemPriceStats(it.catalogItemId);
    const lineShipping = d.shippingIncluded || !d.shippingCostTotal ? null : (d.shippingCostTotal * it.quantity) / totalQty;
    const effCost = effectiveUnitCost({
      unitCost: it.unitCost,
      quantity: it.quantity,
      shippingIncluded: d.shippingIncluded,
      shippingCostTotal: lineShipping,
    });
    if (stats.last3Avg !== null && effCost > stats.last3Avg) {
      anyOverThreshold = true;
      const item = await prisma.purchaseCatalogItem.findUnique({ where: { id: it.catalogItemId }, select: { name: true } });
      lineChecks.push({ catalogItemName: item?.name ?? "?", effCost, last3Avg: stats.last3Avg });
    }
  }
  if (anyOverThreshold && !d.justification?.trim()) {
    const detail = lineChecks.map((l) => `${l.catalogItemName} ($${l.effCost.toFixed(2)} vs. $${l.last3Avg.toFixed(2)})`).join(", ");
    return NextResponse.json(
      { error: `Uno o más productos superan el promedio de las últimas compras (${detail}) — agrega una justificación.` },
      { status: 400 }
    );
  }

  const catalogItems = await prisma.purchaseCatalogItem.findMany({
    where: { id: { in: d.items.map((it) => it.catalogItemId) } },
    select: { id: true, name: true },
  });
  if (catalogItems.length !== new Set(d.items.map((it) => it.catalogItemId)).size) {
    return NextResponse.json({ error: "Uno o más insumos no fueron encontrados." }, { status: 404 });
  }
  const nameById = new Map(catalogItems.map((c) => [c.id, c.name]));

  const groupId = randomUUID();
  const isAdmin = session.user.role === "admin";
  const requests = await prisma.$transaction(
    d.items.map((it) => {
      const lineShipping = d.shippingIncluded || !d.shippingCostTotal ? null : (d.shippingCostTotal * it.quantity) / totalQty;
      return prisma.purchaseRequest.create({
        data: {
          groupId,
          deptId: session.user.deptId!,
          catalogItemId: it.catalogItemId,
          supplierId: d.supplierId,
          quantity: it.quantity,
          unitCost: it.unitCost,
          totalCost: it.quantity * it.unitCost,
          quoteImageUrl: d.quoteImageUrl,
          quoteReadTotal: d.quoteReadTotal,
          quoteReferenceCode: d.quoteReferenceCode || null,
          quoteConfirmedAt: new Date(),
          shippingIncluded: d.shippingIncluded,
          carrierId: d.shippingIncluded ? null : d.carrierId,
          shippingCostTotal: d.shippingIncluded ? null : lineShipping,
          shippingPaymentMethod: d.shippingIncluded ? null : d.shippingPaymentMethod,
          justification: anyOverThreshold ? d.justification!.trim() : null,
          status: "PENDING_APPROVAL",
          requestedById: isAdmin ? null : session.user.id,
          requestedByDeptId: session.user.deptId!,
        },
      });
    })
  );

  // Confirmado 2026-07-30: push en tiempo real al admin, aparte de la
  // notificación diaria de Pendientes — apenas se envía la solicitud.
  const summary = d.items.length === 1 ? nameById.get(d.items[0].catalogItemId) : `${d.items.length} productos`;
  await sendPushToOwner("admin", {
    title: anyOverThreshold ? "🔴 Nueva solicitud — precio por encima del historial" : "Nueva solicitud de compra",
    body: `${summary} · $${groupTotal.toFixed(2)}`,
    url: "/admin",
  }).catch(() => null);

  const full = await prisma.purchaseRequest.findMany({ where: { groupId }, include: requestInclude });
  return NextResponse.json(full, { status: 201 });
}
