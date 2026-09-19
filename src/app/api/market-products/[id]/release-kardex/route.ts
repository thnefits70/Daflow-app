import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canDecideMarketProductPurchase } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { releasePendingKardexForCatalogItem } from "@/lib/stockKardex";

// Confirmado 2026-09-18 (Análisis de Mercado + INVESTOCK): liberación final,
// exclusiva de Bryan (mismo guard que decidir qué comprar, Etapa 6) — solo
// después de que Heidy ya confirmó el ID de Dropi (publishedAt). Le pone el
// justCode real al catálogo y suma al Kardex, en orden real, cualquier
// compra de este producto que ya se haya recibido mientras se esperaba el ID.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canDecideMarketProductPurchase()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.marketProductProposal.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (!existing.catalogItemId) return NextResponse.json({ error: "Falta el catálogo de este producto — avisa al admin." }, { status: 409 });
  if (!existing.dropiProductId || !existing.publishedAt) {
    return NextResponse.json({ error: "Heidy todavía no confirma el ID de Dropi." }, { status: 409 });
  }
  if (existing.kardexReleasedAt) return NextResponse.json({ error: "Ya se liberó al Kardex." }, { status: 409 });

  const result = await releasePendingKardexForCatalogItem(existing.catalogItemId, existing.dropiProductId);

  const isAdmin = session.user.role === "admin";
  const updated = await prisma.marketProductProposal.update({
    where: { id },
    data: { kardexReleasedById: isAdmin ? null : session.user.id, kardexReleasedAt: new Date() },
  });

  const affectedRequests = await prisma.purchaseRequest.findMany({
    where: { catalogItemId: existing.catalogItemId, status: "RECEIVED" },
    select: { requestedById: true },
    distinct: ["requestedById"],
  });
  await Promise.all(
    affectedRequests
      .filter((r) => r.requestedById)
      .map((r) =>
        notifyOwner(r.requestedById!, {
          title: "Compra ya está en INVESTOCK",
          body: `${existing.productName} ya tiene su ID de Dropi confirmado y quedó sumado al Kardex.`,
          url: "/area/workspace",
        }).catch(() => null)
      )
  );

  return NextResponse.json({ ...updated, entriesPosted: result.entriesPosted });
}
