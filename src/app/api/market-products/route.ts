import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import {
  canProposeMarketProduct,
  canReviewMarketProduct,
  canPublishMarketProduct,
  canBrandMarketProduct,
  canViewB2BPricing,
  canViewB2CPricing,
} from "@/lib/guards";
import {
  computeMarketProductSalePrice,
  computeBenistockPrice,
  computeB2BPrice,
  computeB2CPrice,
  computeComboBenistockPrice,
  computeComboB2BPrice,
  computeComboB2CPrice,
  pickPrimarySupplierPrice,
  B2B_MARGIN_DEFAULT,
  nextMarketProductProposalNumber,
  formatMarketProductProposalCode,
} from "@/lib/marketProduct";
import { getAllCurrentStock } from "@/lib/stockKardex";
import { getFinanzasDeptId } from "@/lib/inventoryKpis";
import { notifyOwner } from "@/lib/notifications";

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
  noCompetitorData: z.boolean().optional(),
  discoverySourceNote: z.string().trim().max(300).optional(),
  insuranceRatePercent: z.number().min(0).max(100).optional(),
  fulfillmentCost: z.number().nonnegative().optional(),
  marginPercent: z.number().min(0).max(99).optional(),
  primarySupplierPrice: supplierPriceSchema,
  // Confirmado 2026-09-22: si la propuesta viene de "Pasar a Proponer" en
  // Ganadores no encontrados, ese registro queda marcado como ya propuesto.
  unfoundWinningProductId: z.string().optional(),
});

// Confirmado 2026-09-09 (Fase 2, Análisis de Mercado): Jariel propone un
// producto ganador con su calculadora de precio — el precio de venta se
// calcula SIEMPRE server-side, nunca se confía en el que manda el
// navegador. Requiere 1 proveedor (obligatorio). Confirmado 2026-09-17,
// pedido explícito del usuario: se quitó la opción de agregar un 2°
// proveedor en la misma propuesta — el campo secundario sigue existiendo
// en la base de datos por si hay propuestas viejas con dos, pero ya no se
// puede crear una nueva con más de uno.
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
  // Confirmado 2026-09-10 (pedido de Jariel): si marca "sin datos de
  // competencia" (producto recomendado por proveedor, sin nada que buscar
  // en Dropi/Dropkiller/Rocket), esos campos se ignoran aunque vengan
  // llenos — a propósito vacíos, no un olvido.
  const skipCompetitor = d.platform === "ROCKET" || !!d.noCompetitorData;

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
      competitorId: skipCompetitor ? null : d.competitorId || null,
      competitorPrice: skipCompetitor ? null : d.competitorPrice ?? null,
      competitorBodegaName: skipCompetitor ? null : d.competitorBodegaName || null,
      competitorProductName: skipCompetitor ? null : d.competitorProductName || null,
      noCompetitorData: !!d.noCompetitorData,
      discoverySourceNote: d.noCompetitorData ? d.discoverySourceNote || null : null,
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
        ],
      },
    },
    include: { supplierPrices: { include: { supplier: { select: { name: true } } } } },
  });

  if (d.unfoundWinningProductId) {
    await prisma.unfoundWinningProduct.updateMany({
      where: { id: d.unfoundWinningProductId, status: { not: "PROPOSED" } },
      data: { status: "PROPOSED", proposalId: created.id },
    });
  }

  // Bug reportado por Jariel 2026-09-18: a Bryan nunca le llegaba aviso de
  // que había una propuesta nueva esperando su aprobación — notifyOwner solo
  // se disparaba al aprobar/rechazar, nunca al proponer. Mismo patrón que
  // brand/route.ts para ubicar al líder de MKT.
  const marketingLead = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "MKT" } }, select: { id: true } });
  if (marketingLead) {
    await notifyOwner(marketingLead.id, {
      title: "Nueva propuesta de producto",
      body: `${created.productName} — esperando tu aprobación`,
      url: "/area/workspace?tab=analisis-mercado",
    }).catch(() => null);
  }

  return NextResponse.json(created, { status: 201 });
}

const includeFull = {
  proposedBy: { select: { name: true } },
  reviewedBy: { select: { name: true } },
  publishedBy: { select: { name: true } },
  brandedBy: { select: { name: true } },
  readyToBuyBy: { select: { name: true } },
  kardexReleasedBy: { select: { name: true } },
  chosenSupplier: { select: { id: true, name: true } },
  catalogItem: { select: { id: true, name: true, photos: true, awaitingDropiId: true } },
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

  // Confirmado 2026-09-08 (Fase 2), ampliado 2026-09-14: pantalla de solo
  // consulta para quien vende por Ventas Externas — nunca expone
  // supplierPrices/batchCost crudos, solo precios de venta ya calculados. Ya
  // no depende de que Jariel haya calculado el producto — cubre TODO el
  // catálogo (~492 productos), usando su costo promedio real de Kardex
  // cuando no tiene propuesta propia (mismo criterio de
  // priceExternalSaleItems en lib/externalSales.ts). Un producto sin
  // propuesta Y sin costo de Kardex (nunca tuvo movimiento, costo $0)
  // simplemente no aparece — no hay nada que calcular.
  // Confirmado 2026-09-15, pedido explícito del usuario: antes cada quien
  // solo veía el precio de SU propio canal (B2B o B2C, nunca los dos, nunca
  // Benistock) — ahora cualquiera con acceso a esta pantalla ve las tres
  // columnas juntas por producto (Benistock = costo real sin ganancia, B2B,
  // B2C). Decisión consciente: expone el costo real al equipo de ventas,
  // algo que antes se evitaba a propósito.
  if (view === "consulta") {
    const [canB2B, canB2C] = await Promise.all([canViewB2BPricing(), canViewB2CPricing()]);
    if (!canB2B && !canB2C) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

    const deptId = await getFinanzasDeptId();
    const [allStock, proposals, combos, justSnapshots] = await Promise.all([
      getAllCurrentStock(),
      prisma.marketProductProposal.findMany({
        where: { catalogItemId: { not: null } },
        include: { supplierPrices: true },
      }),
      prisma.dropiCombo.findMany({ include: { components: true } }),
      deptId
        ? prisma.inventoryProductSnapshot.findMany({
            where: { deptId },
            distinct: ["productCode"],
            orderBy: [{ productCode: "asc" }, { createdAt: "desc" }],
            select: { productCode: true, avgCost: true },
          })
        : Promise.resolve([]),
    ]);
    const proposalByCatalogItemId = new Map(
      proposals
        .filter((p) => p.catalogItemId && pickPrimarySupplierPrice(p.supplierPrices))
        .map((p) => {
          const supplier = pickPrimarySupplierPrice(p.supplierPrices)!;
          return [
            p.catalogItemId!,
            { batchCost: supplier.batchCost, batchUnits: supplier.batchUnits, freightCost: supplier.freightCost, insuranceRatePercent: p.insuranceRatePercent, fulfillmentCost: p.fulfillmentCost, costSource: "proposal" as const },
          ] as const;
        })
    );
    const stockByCatalogItemId = new Map(allStock.map((s) => [s.catalogItemId, s]));
    const justAvgCostByCode = new Map(justSnapshots.map((s) => [s.productCode.trim(), s.avgCost]));

    const catalogItemIds = allStock.map((s) => s.catalogItemId);
    const catalogItems = await prisma.purchaseCatalogItem.findMany({ where: { id: { in: catalogItemIds } }, select: { id: true, name: true, justCode: true, photos: true } });
    const catalogItemById = new Map(catalogItems.map((c) => [c.id, c]));

    // Confirmado 2026-09-14: mismo default que MarketProductProposal (seguro
    // 6%, fulfillment $0.75) para un producto sin propuesta propia, priceado
    // a partir de su costo promedio de Kardex. Confirmado 2026-09-17, pedido
    // explícito del usuario: si tampoco tiene costo de Kardex (INVESTOCK),
    // respaldo TEMPORAL con el costo promedio del último archivo de Just —
    // mientras se termina de cargar INVESTOCK para todos los productos.
    // `costSource` marca cuál se usó, para resaltarlo en el frontend. Un
    // producto sin ninguno de los tres no tiene nada que calcular.
    function resolveBase(catalogItemId: string) {
      const proposalBase = proposalByCatalogItemId.get(catalogItemId);
      if (proposalBase) return proposalBase;
      const stock = stockByCatalogItemId.get(catalogItemId);
      if (stock && stock.avgCost > 0) return { batchCost: stock.avgCost, batchUnits: 1, freightCost: null, insuranceRatePercent: 6, fulfillmentCost: 0.75, costSource: "kardex" as const };
      const justCode = catalogItemById.get(catalogItemId)?.justCode;
      const justAvgCost = justCode ? justAvgCostByCode.get(justCode.trim()) : undefined;
      if (justAvgCost && justAvgCost > 0) return { batchCost: justAvgCost, batchUnits: 1, freightCost: null, insuranceRatePercent: 6, fulfillmentCost: 0.75, costSource: "just" as const };
      return null;
    }

    const productRows = allStock
      .map((s) => {
        const base = resolveBase(s.catalogItemId);
        if (!base) return null;
        const catalogItem = catalogItemById.get(s.catalogItemId);
        if (!catalogItem) return null;
        return {
          id: catalogItem.id,
          name: catalogItem.name,
          justCode: catalogItem.justCode,
          photos: catalogItem.photos,
          isCombo: false,
          costSource: base.costSource,
          benistockPrice: computeBenistockPrice(base),
          b2bPriceDefault: computeB2BPrice({ ...base, marginPercent: B2B_MARGIN_DEFAULT }),
          b2cPrice1Unit: computeB2CPrice({ ...base, totalQuantity: 1 }),
          b2cPrice2to11: computeB2CPrice({ ...base, totalQuantity: 2 }),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Confirmado 2026-09-15, pedido explícito del usuario: un combo (varios
    // productos reales empacados y enviados como uno solo, ver DropiCombo)
    // también aparece acá con sus propios Benistock/B2B/B2C — ver
    // computeComboBenistockPrice/computeComboB2BPrice/computeComboB2CPrice
    // en marketProduct.ts para el porqué de por qué NO es solo sumar el
    // precio de cada producto (el fulfillment y el flete de B2C se cobran
    // una sola vez por combo, no por producto). Un combo con algún
    // componente sin costo resuelto simplemente no aparece, igual que un
    // producto individual sin costo.
    const comboRows = combos
      .map((combo) => {
        const components = combo.components.map((c) => ({ base: resolveBase(c.catalogItemId), quantity: c.quantity }));
        if (components.some((c) => !c.base)) return null;
        const resolvedComponents = components.map((c) => ({ ...c.base!, quantity: c.quantity }));
        // Si algún componente del combo usa un respaldo menos confiable, el
        // combo entero se marca con ese — no tiene sentido mostrarlo como
        // "real" si una sola pieza viene estimada.
        const costSource = components.some((c) => c.base!.costSource === "just")
          ? ("just" as const)
          : components.some((c) => c.base!.costSource === "kardex")
            ? ("kardex" as const)
            : ("proposal" as const);
        return {
          id: combo.id,
          name: combo.label ?? combo.code,
          justCode: combo.code,
          photos: [] as string[],
          isCombo: true,
          costSource,
          benistockPrice: computeComboBenistockPrice(resolvedComponents),
          b2bPriceDefault: computeComboB2BPrice(resolvedComponents, B2B_MARGIN_DEFAULT),
          b2cPrice1Unit: computeComboB2CPrice(resolvedComponents, 1),
          b2cPrice2to11: computeComboB2CPrice(resolvedComponents, 2),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    return NextResponse.json([...productRows, ...comboRows]);
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
