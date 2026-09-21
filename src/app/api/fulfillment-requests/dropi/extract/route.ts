import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSubmitFulfillmentRequest } from "@/lib/guards";
import { readOutflowManifest, matchOutflowNamesToCatalog } from "@/lib/merchandiseOutflowAi";
import { groupOutflowRows } from "@/lib/merchandiseOutflowGrouping";

const MAX_PHOTOS = 40;
const schema = z.object({ photoUrls: z.array(z.string().min(1)).min(1).max(MAX_PHOTOS) });

// Confirmado 2026-09-21: reusa TAL CUAL la misma IA y el mismo desglose de
// combos ya construidos para Registro de Egresos (readOutflowManifest +
// groupOutflowRows) — ninguna llamada nueva a IA, ver
// feedback_ai_matching_cost_boundary. La diferencia es que acá Yair sube la
// captura del manifiesto LIMPIO (antes de que nadie lo resalte con
// marcador ni lo corrija a mano), así que el número que la IA lee para un
// combo es siempre "cuántas veces se pidió" — groupOutflowRows ya lo
// multiplica por la receta registrada, igual que hace hoy para el despacho
// real de Daniel.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canSubmitFulfillmentRequest()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const tooMany = parsed.error.issues.some((i) => i.path[0] === "photoUrls" && i.code === "too_big");
    return NextResponse.json({ error: tooMany ? `Máximo ${MAX_PHOTOS} fotos por lectura.` : "Datos inválidos." }, { status: 400 });
  }

  const [catalog, combos] = await Promise.all([
    prisma.purchaseCatalogItem.findMany({ select: { id: true, name: true, photos: true, justCode: true, pendingRegistration: true } }),
    prisma.dropiCombo.findMany({
      include: { components: { include: { catalogItem: { select: { id: true, name: true, photos: true, justCode: true, pendingRegistration: true } } } } },
    }),
  ]);
  const catalogByName = new Map(catalog.map((c) => [c.name.trim().toLowerCase(), c]));
  const catalogByJustCode = new Map(catalog.filter((c) => c.justCode).map((c) => [c.justCode!.trim().toLowerCase(), c]));
  const combosByCode = new Map(combos.map((c) => [c.code.trim().toLowerCase(), c]));

  try {
    const result = await readOutflowManifest({ photoUrls: parsed.data.photoUrls, documentKind: "despacho", actorId: session.user.id });
    const noStockRows = result.rows.filter((r) => r.outOfStock);
    const readableRows = result.rows.filter((r) => !r.outOfStock);

    // Nunca se calcula mal en silencio: groupOutflowRows desglosa un combo
    // en sus componentes reales, pero si ese combo todavía no tiene receta
    // registrada, su lista de componentes está vacía y la fila desaparecería
    // sin avisar — se detecta ACÁ, antes de agrupar, para poder advertirlo.
    const combosMissingRecipe = readableRows
      .filter((r) => r.code && (combosByCode.get(r.code.trim().toLowerCase())?.components.length ?? -1) === 0)
      .map((r) => ({ code: r.code as string, name: r.name, quantity: r.quantity }));

    const catalogMatches = await matchOutflowNamesToCatalog({ names: readableRows.map((r) => r.name), catalogNames: catalog.map((c) => c.name), actorId: session.user.id });
    const rowsWithMatch = readableRows.map((r, i) => ({ ...r, catalogMatch: catalogMatches[i] ?? null }));
    const rows = groupOutflowRows(rowsWithMatch, { catalogByJustCode, catalogByName, combosByCode });

    return NextResponse.json({ rows, excludedNoStock: noStockRows.map((r) => ({ name: r.name, code: r.code })), combosMissingRecipe });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo leer el documento." }, { status: 400 });
  }
}
