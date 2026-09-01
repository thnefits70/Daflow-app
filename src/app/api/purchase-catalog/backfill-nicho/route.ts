import { NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageJustCatalog } from "@/lib/guards";
import { suggestNichoIfMissing, NICHO_AI_MODEL } from "@/lib/nichoAi";
import { computeCostUsd } from "@/lib/aiPricing";

// Confirmado 2026-09-01: pedido explícito del usuario — de aquí en adelante
// todo producto nuevo se sugiere solo (ver suggestNichoIfMissing en
// purchase-catalog/route.ts y just-catalog/apply/route.ts), pero el catálogo
// que ya existía antes de eso quedó sin nicho. Esta ruta corre esa sugerencia
// UNA vez sobre lo que falta, gastando dinero real — por eso el GET muestra
// el costo estimado antes de que alguien confirme el POST.
const ESTIMATED_INPUT_TOKENS_PER_ITEM = 400;
const ESTIMATED_OUTPUT_TOKENS_PER_ITEM = 20;

export async function GET() {
  if (!(await canManageJustCatalog())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const missingCount = await prisma.purchaseCatalogItem.count({ where: { nicho: null } });
  const estimatedCostUsd = missingCount * computeCostUsd(NICHO_AI_MODEL, ESTIMATED_INPUT_TOKENS_PER_ITEM, ESTIMATED_OUTPUT_TOKENS_PER_ITEM);
  return NextResponse.json({ missingCount, estimatedCostUsd });
}

export async function POST() {
  if (!(await canManageJustCatalog())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const missing = await prisma.purchaseCatalogItem.findMany({ where: { nicho: null }, select: { id: true } });
  if (missing.length === 0) return NextResponse.json({ queuedCount: 0 });

  // Corre después de responder — con cientos de productos, esperar la
  // llamada de IA de cada uno adentro del mismo request superaría cualquier
  // límite de tiempo de la función serverless. Best-effort, en paralelo.
  after(async () => {
    await Promise.allSettled(missing.map((i) => suggestNichoIfMissing(i.id)));
  });

  return NextResponse.json({ queuedCount: missing.length });
}
