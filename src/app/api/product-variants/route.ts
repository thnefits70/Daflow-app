import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow, canCaptureMerchandiseOutflow, dbUserId } from "@/lib/guards";
import { addVariant, getVariantProduct, mergeVariants, recentVariantEdits, removeVariant, renameVariant, searchVariantProducts } from "@/lib/variantEdit";

// Tallas y colores de los productos (pedido del usuario 2026-10-15, aprobado
// por Daniel): todo el equipo de INVESTOCK (Daniel incluido) y el admin.
async function access() {
  const session = await auth();
  if (!session) return null;
  const isLead = session.user.role === "admin" || (await canActOnMerchandiseOutflow());
  if (!isLead && !(await canCaptureMerchandiseOutflow())) return null;
  return { session, isLead };
}

export async function GET(req: NextRequest) {
  const a = await access();
  if (!a) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id");
  if (id) return NextResponse.json({ product: await getVariantProduct(id) });
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const [products, recent] = await Promise.all([searchVariantProducts(q), a.isLead && !q.trim() ? recentVariantEdits() : null]);
  return NextResponse.json({ products, recent });
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), catalogItemId: z.string().min(1), name: z.string().min(1).max(120) }),
  z.object({ action: z.literal("rename"), variantId: z.string().min(1), name: z.string().min(1).max(120) }),
  z.object({ action: z.literal("merge"), targetId: z.string().min(1), sourceIds: z.array(z.string().min(1)).min(1).max(30) }),
  z.object({ action: z.literal("remove"), variantId: z.string().min(1) }),
]);

export async function POST(req: NextRequest) {
  const a = await access();
  if (!a) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const userId = dbUserId(a.session.user.id);
  const userName = userId ? ((await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? null) : null;
  const who = { userId, userName };
  const d = parsed.data;
  const r =
    d.action === "add"
      ? await addVariant(d.catalogItemId, d.name, who)
      : d.action === "rename"
        ? await renameVariant(d.variantId, d.name, who)
        : d.action === "merge"
          ? await mergeVariants(d.targetId, d.sourceIds, who)
          : await removeVariant(d.variantId, who);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
