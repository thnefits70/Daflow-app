import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";

const schema = z.object({ fulfillmentSize: z.enum(["SMALL", "NORMAL"]) });

// Confirmado 2026-09-30, pedido del usuario: si quien compra (Jariel,
// Nairoby) marcó mal un producto como pequeño o normal, lo corrige él mismo
// desde el formulario de compras — el usuario no quiere que eso le llegue a
// él. Queda registrado quién y cuándo. Solo productos que ya estaban marcados
// (el primer marcado va con la compra, ver checkAndSaveFulfillmentSizes).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Elige pequeño o normal." }, { status: 400 });

  const { id } = await params;
  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id }, select: { fulfillmentSize: true } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!item.fulfillmentSize) return NextResponse.json({ error: "Este producto todavía no está marcado — se marca al pedir la compra." }, { status: 409 });

  await prisma.purchaseCatalogItem.update({
    where: { id },
    data: { fulfillmentSize: parsed.data.fulfillmentSize, fulfillmentSizeSetAt: new Date(), fulfillmentSizeSetById: session.user.role === "admin" ? null : session.user.id },
  });
  return NextResponse.json({ ok: true });
}
