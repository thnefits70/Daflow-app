import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManageJustCatalog, canSubmitFulfillmentRequest } from "@/lib/guards";
import { correctComboRecipeFromLot } from "@/lib/fulfillmentGuides";

const schema = z.object({
  code: z.string().trim().min(1),
  components: z.array(z.object({ catalogItemId: z.string().min(1), quantity: z.number().int().positive() })).min(1),
});

// Pedido del usuario 2026-09-25: Yair corrige desde su corte en preparación
// la receta de un combo que armó mal — ver correctComboRecipeFromLot.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const allowed = (await canSubmitFulfillmentRequest()) || (await canManageJustCatalog());
  if (!allowed || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const result = await correctComboRecipeFromLot({ lotId: id, ...parsed.data, actorName: session.user.name ?? "Alguien" });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
