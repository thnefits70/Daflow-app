import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canManageJustCatalog } from "@/lib/guards";
import { resolveCostBasisForCatalogItems, computeComboDropiPrice, DROPI_MARGIN_DEFAULT } from "@/lib/marketProduct";

const schema = z.object({
  components: z.array(z.object({ catalogItemId: z.string().min(1), quantity: z.number().int().positive() })).min(1),
});

// Confirmado 2026-09-16, pedido explícito del usuario: los combos se suben
// a Dropi, así que necesitan su Precio Dropi calculado en vivo mientras se
// arman en DropiComboManager.tsx — nunca se guarda, es solo vista previa.
// Si a algún producto le falta el costo, se avisa explícito en vez de
// omitirlo en silencio del cálculo (antes era lo que hacía el resto de
// precios de combo).
export async function POST(req: NextRequest) {
  if (!(await canManageJustCatalog())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const costBasisByItemId = await resolveCostBasisForCatalogItems(parsed.data.components.map((c) => c.catalogItemId));
  const missingCostItemIds = parsed.data.components.filter((c) => !costBasisByItemId.has(c.catalogItemId)).map((c) => c.catalogItemId);

  if (missingCostItemIds.length > 0) {
    return NextResponse.json({ dropiPrice: null, missingCostItemIds });
  }

  const components = parsed.data.components.map((c) => ({ ...costBasisByItemId.get(c.catalogItemId)!, quantity: c.quantity }));
  const dropiPrice = computeComboDropiPrice(components, DROPI_MARGIN_DEFAULT);
  return NextResponse.json({ dropiPrice, missingCostItemIds: [] });
}
