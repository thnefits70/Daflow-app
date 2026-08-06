import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { getCatalogItemPriceStats } from "@/lib/purchases";

const OWN_DELETE_WINDOW_MS = 2 * 60 * 60 * 1000;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const stats = await getCatalogItemPriceStats(id);
  return NextResponse.json({ id: item.id, name: item.name, photos: item.photos, stats });
}

// Confirmado 2026-08-03/06: admin puede eliminar cualquier producto/
// mercadería/insumo sin historial de compras, sin importar cuándo se creó.
// Quien lo creó (no admin) puede eliminarlo él mismo SOLO si además pasa
// esto dentro de las primeras 2 horas desde que lo creó — pasado ese plazo,
// o si ya tiene historial, queda igual de bloqueado que para cualquiera —
// nunca se deja que la restricción de la base de datos reviente con un
// error de llave foránea.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const isAdmin = session.user.role === "admin";
  if (!isAdmin) {
    if (!(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    if (item.createdById !== session.user.id) {
      return NextResponse.json({ error: "Solo quien creó este producto (o el admin) puede eliminarlo." }, { status: 403 });
    }
    const ageMs = Date.now() - item.createdAt.getTime();
    if (ageMs > OWN_DELETE_WINDOW_MS) {
      return NextResponse.json(
        { error: "Ya pasaron más de 2 horas desde que se creó este producto — solo el admin puede eliminarlo ahora." },
        { status: 403 }
      );
    }
  }

  const inUse = await prisma.purchaseRequest.count({ where: { catalogItemId: id } });
  if (inUse > 0) {
    return NextResponse.json(
      { error: "Este producto, mercadería o insumo ya tiene compras registradas — no se puede eliminar sin perder ese historial." },
      { status: 409 }
    );
  }

  await prisma.purchaseCatalogItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
