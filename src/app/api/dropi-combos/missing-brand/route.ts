import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSetMissingComboBrand } from "@/lib/comboAlias";

// Pedido del usuario 2026-10-10: un combo que se vendió en Dropi sin marca
// no puede quedar así. El pedido se despacha igual, pero la asesora B2B no
// puede seguir usando DAFLOW hasta elegir su marca (ComboBrandGate). El admin
// no se bloquea (no es operativo).
export async function GET() {
  const session = await auth();
  if (!session || session.user.role === "admin" || !(await canSetMissingComboBrand())) return NextResponse.json({ items: [] });

  const combos = await prisma.dropiCombo.findMany({
    where: { bodega: null, aliasOfId: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      code: true,
      label: true,
      components: { select: { quantity: true, catalogItem: { select: { name: true, justCode: true, photos: true } } } },
    },
  });
  return NextResponse.json({
    items: combos.map((c) => ({
      id: c.id,
      code: c.code,
      label: c.label,
      components: c.components.map((k) => ({ quantity: k.quantity, name: k.catalogItem.name, justCode: k.catalogItem.justCode, photo: k.catalogItem.photos[0] ?? null })),
    })),
  });
}
