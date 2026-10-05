import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewComboSuggestions } from "@/lib/guards";
import { priceCombos } from "@/lib/comboSuggestions";
import type { ComboSuggestionStatus } from "@/generated/prisma/client";

const CATALOG_SELECT = { id: true, name: true, justCode: true, photos: true, nicho: true } as const;
const VALID_STATUSES: ComboSuggestionStatus[] = ["SUGERIDO", "SELECCIONADO", "PENDIENTE_APROBACION", "APROBADO", "RECHAZADO", "CREADO_EN_DROPI"];

// Pedido del usuario 2026-09-30: cada sugerencia trae su precio Dropi y su
// stock recomendado ya calculados (en vivo hasta que se aprueba; desde ahí
// manda el precio congelado), listo para copiar.
export async function GET(req: NextRequest) {
  if (!(await canViewComboSuggestions())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const statusParam = req.nextUrl.searchParams.get("status");
  const status = statusParam && VALID_STATUSES.includes(statusParam as ComboSuggestionStatus) ? (statusParam as ComboSuggestionStatus) : null;
  const suggestions = await prisma.comboSuggestion.findMany({
    // DESCARTADO = no elegido en su semana; solo sirve para que la IA aprenda.
    where: status ? { status } : { status: { not: "DESCARTADO" } },
    orderBy: { generatedAt: "desc" },
    include: {
      items: { include: { catalogItem: { select: CATALOG_SELECT } }, orderBy: { role: "asc" } },
      dropiCombo: { select: { code: true } },
      selectedBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
      createdInDropiBy: { select: { name: true } },
    },
  });

  const pricing = await priceCombos(
    suggestions.filter((s) => s.status !== "RECHAZADO").map((s) => ({ id: s.id, parts: s.items.map((i) => ({ catalogItemId: i.catalogItemId, quantity: i.quantity })) }))
  );
  return NextResponse.json({
    suggestions: suggestions.map((s) => ({ ...s, pricing: pricing.get(s.id) ?? null })),
  });
}
