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
// fotos reales brandeadas — esto crea/matricula el PurchaseCatalogItem de
// verdad (antes de esto, el producto no existe en el catálogo real de
// Compras/Inventario). El justCode se pre-llena con el ID de Dropi, para
// que cuando Daniel suba el export de Just más adelante, este producto ya
// aparezca vinculado en vez de crear un esqueleto duplicado.
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

  const nameTaken = await prisma.purchaseCatalogItem.findFirst({
    where: { name: { equals: existing.productName, mode: "insensitive" } },
  });
  if (nameTaken) {
    return NextResponse.json(
      { error: `Ya existe "${nameTaken.name}" en el catálogo — no se puede crear un duplicado. Avisa al admin.` },
      { status: 409 }
    );
  }

  const justCodeTaken = existing.dropiProductId
    ? await prisma.purchaseCatalogItem.findUnique({ where: { justCode: existing.dropiProductId } })
    : null;

  const catalogItem = await prisma.purchaseCatalogItem.create({
    data: {
      name: existing.productName,
      photos: parsed.data.photos,
      description: existing.description,
      justCode: justCodeTaken ? null : existing.dropiProductId,
    },
  });

  const updated = await prisma.marketProductProposal.update({
    where: { id },
    data: { brandedById: session.user.id, brandedAt: new Date(), catalogItemId: catalogItem.id },
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
