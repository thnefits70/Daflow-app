import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import {
  canProposeMarketProduct,
  canReviewMarketProduct,
  canPublishMarketProduct,
  canBrandMarketProduct,
} from "@/lib/guards";
import { computeMarketProductSalePrice, nextMarketProductProposalNumber, formatMarketProductProposalCode } from "@/lib/marketProduct";

const supplierPriceSchema = z.object({
  supplierId: z.string(),
  batchCost: z.number().positive(),
  batchUnits: z.number().int().positive(),
  freightCost: z.number().nonnegative().optional(),
});

const createSchema = z.object({
  productName: z.string().trim().min(1, "Falta el nombre comercial."),
  referenceImageUrl: z.string().url("Falta la imagen referencial."),
  description: z.string().trim().optional(),
  platform: z.enum(["DROPI", "ROCKET", "BOTH"]),
  competitorId: z.string().trim().optional(),
  competitorPrice: z.number().positive().optional(),
  competitorBodegaName: z.string().trim().optional(),
  competitorProductName: z.string().trim().optional(),
  insuranceRatePercent: z.number().min(0).max(100).optional(),
  fulfillmentCost: z.number().nonnegative().optional(),
  marginPercent: z.number().min(0).max(99).optional(),
  primarySupplierPrice: supplierPriceSchema,
  secondarySupplierPrice: supplierPriceSchema.optional(),
});

// Confirmado 2026-09-09 (Fase 2, Análisis de Mercado): Jariel propone un
// producto ganador con su calculadora de precio — el precio de venta se
// calcula SIEMPRE server-side, nunca se confía en el que manda el
// navegador. Requiere al menos 1 proveedor (obligatorio); un 2° es opcional.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canProposeMarketProduct()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const d = parsed.data;

  if (d.platform === "ROCKET" && (d.competitorId || d.competitorPrice || d.competitorBodegaName || d.competitorProductName)) {
    return NextResponse.json({ error: "Los datos de competencia solo aplican si la plataforma incluye Dropi." }, { status: 400 });
  }

  const insuranceRatePercent = d.insuranceRatePercent ?? 6;
  const fulfillmentCost = d.fulfillmentCost ?? 0.75;
  const marginPercent = d.marginPercent ?? 20;

  const calculatedSalePrice = computeMarketProductSalePrice({
    batchCost: d.primarySupplierPrice.batchCost,
    batchUnits: d.primarySupplierPrice.batchUnits,
    freightCost: d.primarySupplierPrice.freightCost ?? null,
    insuranceRatePercent,
    fulfillmentCost,
    marginPercent,
  });

  const isAdmin = session.user.role === "admin";
  const number = await nextMarketProductProposalNumber();

  const created = await prisma.marketProductProposal.create({
    data: {
      code: formatMarketProductProposalCode(number),
      productName: d.productName,
      referenceImageUrl: d.referenceImageUrl,
      description: d.description || null,
      platform: d.platform,
      competitorId: d.platform === "ROCKET" ? null : d.competitorId || null,
      competitorPrice: d.platform === "ROCKET" ? null : d.competitorPrice ?? null,
      competitorBodegaName: d.platform === "ROCKET" ? null : d.competitorBodegaName || null,
      competitorProductName: d.platform === "ROCKET" ? null : d.competitorProductName || null,
      insuranceRatePercent,
      fulfillmentCost,
      marginPercent,
      calculatedSalePrice,
      proposedById: isAdmin ? null : session.user.id,
      supplierPrices: {
        create: [
          {
            supplierId: d.primarySupplierPrice.supplierId,
            batchCost: d.primarySupplierPrice.batchCost,
            batchUnits: d.primarySupplierPrice.batchUnits,
            freightCost: d.primarySupplierPrice.freightCost ?? null,
            isPrimary: true,
          },
          ...(d.secondarySupplierPrice
            ? [
                {
                  supplierId: d.secondarySupplierPrice.supplierId,
                  batchCost: d.secondarySupplierPrice.batchCost,
                  batchUnits: d.secondarySupplierPrice.batchUnits,
                  freightCost: d.secondarySupplierPrice.freightCost ?? null,
                  isPrimary: false,
                },
              ]
            : []),
        ],
      },
    },
    include: { supplierPrices: { include: { supplier: { select: { name: true } } } } },
  });

  return NextResponse.json(created, { status: 201 });
}

const includeFull = {
  proposedBy: { select: { name: true } },
  reviewedBy: { select: { name: true } },
  publishedBy: { select: { name: true } },
  brandedBy: { select: { name: true } },
  readyToBuyBy: { select: { name: true } },
  chosenSupplier: { select: { id: true, name: true } },
  catalogItem: { select: { id: true, name: true, photos: true } },
  supplierPrices: { include: { supplier: { select: { id: true, name: true } } } },
} as const;

// Confirmado 2026-09-09: mismo patrón que /api/purchase-requests?status= —
// una sola ruta, una "vista" por rol según quién pregunta.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const view = req.nextUrl.searchParams.get("view") ?? "mine";
  const isAdmin = session.user.role === "admin";

  if (view === "mine") {
    if (!(await canProposeMarketProduct())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    const rows = await prisma.marketProductProposal.findMany({
      where: isAdmin ? {} : { proposedById: session.user.id },
      include: includeFull,
      orderBy: { proposedAt: "desc" },
    });
    return NextResponse.json(rows);
  }

  if (view === "review") {
    if (!(await canReviewMarketProduct())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    const rows = await prisma.marketProductProposal.findMany({
      where: { status: "PENDING_APPROVAL" },
      include: includeFull,
      orderBy: { proposedAt: "asc" },
    });
    return NextResponse.json(rows);
  }

  if (view === "publish") {
    if (!(await canPublishMarketProduct())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    const rows = await prisma.marketProductProposal.findMany({
      where: { status: "APPROVED", publishedAt: null },
      include: includeFull,
      orderBy: { reviewedAt: "asc" },
    });
    return NextResponse.json(rows);
  }

  if (view === "brand") {
    if (!(await canBrandMarketProduct())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    const rows = await prisma.marketProductProposal.findMany({
      where: { publishedAt: { not: null }, brandedAt: null },
      include: includeFull,
      orderBy: { publishedAt: "asc" },
    });
    return NextResponse.json(rows);
  }

  if (view === "traceability") {
    if (!(await canReviewMarketProduct())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    const rows = await prisma.marketProductProposal.findMany({
      where: { status: "APPROVED" },
      include: includeFull,
      orderBy: { proposedAt: "desc" },
    });
    return NextResponse.json(rows);
  }

  if (view === "ready-to-buy") {
    // Confirmado 2026-09-09: Jariel ve acá lo que Bryan ya marcó listo para
    // comprar, para ejecutar la solicitud real en Control de Compras.
    if (!(await canProposeMarketProduct())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    const rows = await prisma.marketProductProposal.findMany({
      where: { readyToBuyAt: { not: null }, purchaseRequests: { none: {} } },
      include: includeFull,
      orderBy: { readyToBuyAt: "asc" },
    });
    return NextResponse.json(rows);
  }

  return NextResponse.json({ error: "Vista desconocida." }, { status: 400 });
}
