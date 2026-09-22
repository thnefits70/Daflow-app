import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dbUserId, requireAdminSession } from "@/lib/guards";
import { actorName } from "@/lib/actorName";
import { deleteCatalogItem, getCatalogItemMergeHistory, mergeCatalogItems, previewCatalogItemAction } from "@/lib/catalogItemMerge";

// Confirmado 2026-09-22, pedido explícito del usuario: juntar/eliminar IDs
// de la Base de datos de productos — exclusivo del admin (Daniel ve, no
// actúa). GET = historial (y sirve para que la pantalla sepa si mostrarse);
// POST = vista previa, juntar o eliminar. Juntar/eliminar siempre vuelven a
// calcular la vista previa en el servidor — nunca confían en lo que mostró
// el navegador.
export async function GET() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const history = await getCatalogItemMergeHistory();
  return NextResponse.json({ history });
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), removedId: z.string().min(1), officialId: z.string().min(1).nullable() }),
  z.object({ action: z.literal("merge"), removedId: z.string().min(1), officialId: z.string().min(1) }),
  z.object({ action: z.literal("delete"), removedId: z.string().min(1) }),
]);

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const body = parsed.data;
  const who = { performedById: dbUserId(session.user.id), performedByName: actorName(session.user.name) };

  if (body.action === "preview") {
    const preview = await previewCatalogItemAction({ removedId: body.removedId, officialId: body.officialId });
    if ("error" in preview) return NextResponse.json({ error: preview.error }, { status: 400 });
    return NextResponse.json({ preview });
  }

  if (body.action === "merge") {
    const result = await mergeCatalogItems({ removedId: body.removedId, officialId: body.officialId, ...who });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json(result);
  }

  const result = await deleteCatalogItem({ itemId: body.removedId, ...who });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json(result);
}
