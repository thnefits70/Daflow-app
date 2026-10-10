import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { correctComboRecipeFromLot } from "@/lib/fulfillmentGuides";

const schema = z.object({
  code: z.string().trim().min(1),
  components: z.array(z.object({ catalogItemId: z.string().min(1), quantity: z.number().int().positive() })).min(1),
});

// Pedido del usuario 2026-09-25: corregir desde el corte en preparación la
// receta de un combo que se armó mal — ver correctComboRecipeFromLot.
// Desde 2026-10-10 (pedido del usuario): la receta se registra una sola vez y
// solo el admin la corrige; Yair y Daniel le avisan.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "Solo el administrador puede corregir la receta de un combo — avísale." }, { status: 403 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const result = await correctComboRecipeFromLot({ lotId: id, ...parsed.data, actorName: session.user.name ?? "Alguien" });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
