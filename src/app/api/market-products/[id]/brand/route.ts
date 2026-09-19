import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canBrandMarketProduct } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

const schema = z.object({
  photos: z.array(z.string().url()).min(3, "Sube mínimo 3 fotos reales brandeadas.").max(3),
});

// Confirmado 2026-09-09 (Fase 2, Análisis de Mercado): Robert sube sus 3
// fotos reales brandeadas para el catálogo (Compras/Inventario) y para la
// ficha de Dropi.
// Confirmado 2026-09-18: el PurchaseCatalogItem ya NO se crea acá — nace en
// review/route.ts apenas Bryan aprueba (Etapa 2), para que la compra pueda
// arrancar sin esperar a Robert. Esta ruta solo actualiza sus fotos/
// descripción con el contenido brandeado; el justCode real (el ID de Dropi)
// lo asigna la liberación final de Bryan en release-kardex/route.ts.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canBrandMarketProduct()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const existing = await prisma.marketProductProposal.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (!existing.publishedAt) return NextResponse.json({ error: "Este producto todavía no está publicado en Dropi." }, { status: 409 });
  if (existing.brandedAt) return NextResponse.json({ error: "Ya está brandeado." }, { status: 409 });
  if (!existing.catalogItemId) return NextResponse.json({ error: "Falta el catálogo de este producto — avisa al admin." }, { status: 409 });

  await prisma.purchaseCatalogItem.update({
    where: { id: existing.catalogItemId },
    data: { photos: parsed.data.photos, description: existing.description },
  });

  const updated = await prisma.marketProductProposal.update({
    where: { id },
    data: { brandedById: session.user.id, brandedAt: new Date() },
  });

  const marketingLead = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "MKT" } }, select: { id: true } });
  if (marketingLead) {
    await notifyOwner(marketingLead.id, {
      title: "Producto listo — trazabilidad completa",
      body: `${existing.productName} ya terminó todo el proceso.`,
      url: "/area/workspace?tab=analisis-mercado",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
