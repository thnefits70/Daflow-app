import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { resolveCostBasisForCatalogItems, computeMarketProductSalePrice, DROPI_MARGIN_DEFAULT } from "@/lib/marketProduct";

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
  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id }, select: { fulfillmentSize: true, name: true, justCode: true } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!item.fulfillmentSize) return NextResponse.json({ error: "Este producto todavía no está marcado — se marca al pedir la compra." }, { status: 409 });

  await prisma.purchaseCatalogItem.update({
    where: { id },
    data: { fulfillmentSize: parsed.data.fulfillmentSize, fulfillmentSizeSetAt: new Date(), fulfillmentSizeSetById: session.user.role === "admin" ? null : session.user.id },
  });
  // Pedido del usuario 2026-09-30: si el producto ya está publicado en Dropi
  // (tiene ID), el Precio Dropi cambió y en Dropi sigue el viejo — Dropi no
  // está conectado, así que se le avisa a quien publica (Heidy) con el nuevo.
  if (item.justCode && item.fulfillmentSize !== parsed.data.fulfillmentSize) {
    const basis = (await resolveCostBasisForCatalogItems([id])).get(id);
    if (basis) {
      const price = computeMarketProductSalePrice({ ...basis, marginPercent: basis.marginPercent ?? DROPI_MARGIN_DEFAULT });
      const size = parsed.data.fulfillmentSize === "SMALL" ? "pequeño" : "normal";
      const publishers = await prisma.user.findMany({ where: { canPublishMarketProduct: true, isActive: true }, select: { id: true } });
      await Promise.all(
        publishers.map((u) =>
          notifyOwner(u.id, {
            title: "Cambió el Precio Dropi de un producto publicado",
            body: `${item.name} (ID ${item.justCode}) ahora es producto ${size}. Precio Dropi nuevo: ${price.toFixed(2)}. Actualízalo en Dropi (también lo ves en Stock actual).`,
            url: "/area/workspace?tab=stock-actual",
          }).catch(() => null)
        )
      );
    }
  }
  return NextResponse.json({ ok: true });
}
