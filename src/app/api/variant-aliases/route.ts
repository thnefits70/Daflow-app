import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canActOnMerchandiseOutflow, dbUserId } from "@/lib/guards";
import { decideGuideVariant, getUnmatchedGuideVariants } from "@/lib/variantSales";

// Unir las variantes de las guías con la lista oficial del conteo (pedido del
// usuario 2026-10-06): lo decide Daniel (líder de Inventario), porque su
// equipo conoce el producto físico.
export async function GET() {
  const session = await auth();
  if (!session || !(await canActOnMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  return NextResponse.json(await getUnmatchedGuideVariants());
}

const schema = z.object({
  catalogItemId: z.string().min(1),
  label: z.string().min(1).max(120),
  variantId: z.string().min(1).nullish(),
  newVariant: z.boolean().optional(),
  ignore: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canActOnMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const r = await decideGuideVariant({ ...parsed.data, userId: dbUserId(session.user.id) });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
