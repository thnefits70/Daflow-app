import { NextRequest, NextResponse } from "next/server";
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

const createSchema = z.object({
  catalogItemId: z.string().min(1),
  supplierId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitCost: z.number().positive(),
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

  const totalCost = d.quantity * d.unitCost;
  const matches = d.quoteReadTotal !== null && Math.abs(d.quoteReadTotal - totalCost) < 0.01;
  const manuallyConfirmed = !!d.quoteReferenceCode;
  if (!matches && !manuallyConfirmed) {
    return NextResponse.json({ error: "La cotización no coincide con lo escrito — verifícala de nuevo antes de enviar." }, { status: 400 });
  }

  const stats = await getCatalogItemPriceStats(d.catalogItemId);
  const effCost = effectiveUnitCost({ unitCost: d.unitCost, quantity: d.quantity, shippingIncluded: d.shippingIncluded, shippingCostTotal: d.shippingCostTotal ?? null });
  const overThreshold = stats.last3Avg !== null && effCost > stats.last3Avg;
  if (overThreshold && !d.justification?.trim()) {
    return NextResponse.json(
      { error: `El costo por unidad ($${effCost.toFixed(2)}) supera el promedio de las últimas compras ($${stats.last3Avg!.toFixed(2)}) — agrega una justificación.` },
      { status: 400 }
    );
  }

  const catalogItem = await prisma.purchaseCatalogItem.findUnique({ where: { id: d.catalogItemId }, select: { name: true } });
  if (!catalogItem) return NextResponse.json({ error: "Insumo no encontrado." }, { status: 404 });

  const request = await prisma.purchaseRequest.create({
    data: {
      deptId: session.user.deptId,
      catalogItemId: d.catalogItemId,
      supplierId: d.supplierId,
      quantity: d.quantity,
      unitCost: d.unitCost,
      totalCost,
      quoteImageUrl: d.quoteImageUrl,
      quoteReadTotal: d.quoteReadTotal,
      quoteReferenceCode: d.quoteReferenceCode || null,
      quoteConfirmedAt: new Date(),
      shippingIncluded: d.shippingIncluded,
      carrierId: d.shippingIncluded ? null : d.carrierId,
      shippingCostTotal: d.shippingIncluded ? null : d.shippingCostTotal,
      shippingPaymentMethod: d.shippingIncluded ? null : d.shippingPaymentMethod,
      justification: overThreshold ? d.justification!.trim() : null,
      status: "PENDING_APPROVAL",
      requestedById: session.user.role === "admin" ? null : session.user.id,
      requestedByDeptId: session.user.deptId,
    },
    include: requestInclude,
  });

  // Confirmado 2026-07-30: push en tiempo real al admin, aparte de la
  // notificación diaria de Pendientes — apenas se envía la solicitud.
  await sendPushToOwner("admin", {
    title: overThreshold ? "🔴 Nueva solicitud — precio por encima del historial" : "Nueva solicitud de compra",
    body: `${catalogItem.name} — ${d.quantity} un. · $${totalCost.toFixed(2)}`,
    url: "/admin/control-de-compras",
  }).catch(() => null);

  return NextResponse.json(request, { status: 201 });
}
