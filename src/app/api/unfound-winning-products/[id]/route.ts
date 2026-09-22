import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canProposeMarketProduct } from "@/lib/guards";
import { unfoundWinningProductSchema, unfoundWinningProductInclude } from "@/lib/unfoundWinningProduct";

// Editar los datos, o solo cambiar el estado (descartar / reactivar). PROPOSED
// no se pone a mano: lo marca POST /api/market-products al enviar la
// propuesta desde "Pasar a Proponer".
const patchSchema = z.union([
  z.object({ status: z.enum(["PENDING", "DISCARDED"]) }),
  unfoundWinningProductSchema,
]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canProposeMarketProduct())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;

  const existing = await prisma.unfoundWinningProduct.findUnique({ where: { id }, select: { status: true } });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (existing.status === "PROPOSED") return NextResponse.json({ error: "Este producto ya se propuso — sigue su avance en Mis propuestas." }, { status: 409 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const d = parsed.data;

  const updated = await prisma.unfoundWinningProduct.update({
    where: { id },
    data: "status" in d
      ? { status: d.status }
      : {
          productName: d.productName,
          imageUrl: d.imageUrl,
          competitorId: d.competitorId || null,
          competitorPrice: d.competitorPrice ?? null,
          supplierId: d.supplierId || null,
          notes: d.notes || null,
        },
    include: unfoundWinningProductInclude,
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canProposeMarketProduct())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;

  const existing = await prisma.unfoundWinningProduct.findUnique({ where: { id }, select: { status: true } });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (existing.status === "PROPOSED") return NextResponse.json({ error: "Este producto ya se propuso — no se puede borrar." }, { status: 409 });

  await prisma.unfoundWinningProduct.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
