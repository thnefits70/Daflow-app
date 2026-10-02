import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canActOnMerchandiseOutflow, dbUserId, requireAdminSession } from "@/lib/guards";
import { actorName } from "@/lib/actorName";
import { dismissDuplicate, findDuplicateCandidates } from "@/lib/catalogDuplicates";
import { mergeCatalogItems, previewCatalogItemAction } from "@/lib/catalogItemMerge";

// Pedido del usuario 2026-10-02: Daniel (líder de Inventarios) revisa los
// posibles duplicados y él mismo los junta (con doble confirmación en
// pantalla) — ya no depende del admin. El admin también puede.
async function allowed() {
  return (await canActOnMerchandiseOutflow()) || !!(await requireAdminSession());
}

export async function GET() {
  if (!(await allowed())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  return NextResponse.json(await findDuplicateCandidates());
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("dismiss"), aId: z.string().min(1), bId: z.string().min(1) }),
  z.object({ action: z.literal("preview"), removedId: z.string().min(1), officialId: z.string().min(1) }),
  z.object({ action: z.literal("merge"), removedId: z.string().min(1), officialId: z.string().min(1) }),
]);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await allowed())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const body = parsed.data;
  const userId = dbUserId(session.user.id);

  if (body.action === "dismiss") {
    await dismissDuplicate(body.aId, body.bId, userId);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "preview") {
    const preview = await previewCatalogItemAction({ removedId: body.removedId, officialId: body.officialId });
    if ("error" in preview) return NextResponse.json({ error: preview.error }, { status: 400 });
    return NextResponse.json({ preview });
  }
  const result = await mergeCatalogItems({ removedId: body.removedId, officialId: body.officialId, performedById: userId, performedByName: actorName(session.user.name) });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json(result);
}
