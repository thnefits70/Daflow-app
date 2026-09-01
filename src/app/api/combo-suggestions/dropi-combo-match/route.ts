import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewComboSuggestions } from "@/lib/guards";
import { normalize, significantWords, findSimilarUnlinkedItem } from "@/lib/justCatalog";

// Confirmado 2026-09-01 (pedido explícito del usuario, Opción B): cuando en
// Sugerencias de Combos alguien marca un producto de ATOM como "es un
// combo", esto busca si ese combo ya está registrado en la "Base de datos
// de productos" (DropiCombo — Daniel ya anota ahí qué productos reales trae
// cada combo, ver schema.prisma). El label de un DropiCombo NUNCA se
// consideró un identificador confiable (el propio modelo lo dice — el
// código de Dropi es la llave real) así que esto es solo una SUGERENCIA:
// la persona siempre confirma "sí, es este" antes de darlo por bueno, igual
// que el resto del emparejamiento por nombre en esta app.
export async function GET(req: NextRequest) {
  if (!(await canViewComboSuggestions())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const name = req.nextUrl.searchParams.get("name")?.trim();
  if (!name) return NextResponse.json({ error: "Falta el nombre del combo." }, { status: 400 });

  const combos = await prisma.dropiCombo.findMany({
    where: { label: { not: null } },
    include: { components: { include: { catalogItem: { select: { id: true, name: true } } } } },
  });
  const labeled = combos.filter((c) => c.label) as (typeof combos[number] & { label: string })[];

  const exact = labeled.find((c) => normalize(c.label) === normalize(name));
  const match =
    exact ??
    (() => {
      const candidates = labeled.map((c) => ({ id: c.id, name: c.label, words: significantWords(c.label) }));
      const similar = findSimilarUnlinkedItem(significantWords(name), candidates);
      return similar ? labeled.find((c) => c.id === similar.id) : undefined;
    })();

  if (!match) return NextResponse.json({ match: null });

  return NextResponse.json({
    match: {
      id: match.id,
      code: match.code,
      label: match.label,
      matchType: exact ? "exact" : "similar",
      components: match.components.map((c) => ({ catalogItemId: c.catalogItemId, name: c.catalogItem.name, quantity: c.quantity })),
    },
  });
}
