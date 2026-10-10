import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canBrandNewIds } from "@/lib/newIdBranding";
import { getLatestProvedixSnapshot } from "@/lib/provedixSnapshot";

// Fotos brandeadas para provedix.com (pedido del usuario 2026-10-10): Robert
// las sube, empezando por los productos que más se venden. El admin solo
// mira (mismo criterio que el resto del brandeo).
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const canEdit = await canBrandNewIds();
  if (!canEdit && session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const snapshot = await getLatestProvedixSnapshot();
  const codes = (snapshot?.products ?? []).map((p) => p.code);
  const items = codes.length
    ? await prisma.purchaseCatalogItem.findMany({
        where: { justCode: { in: codes } },
        select: { id: true, justCode: true, name: true, bodega: true, photos: true, brandedPhotoUrl: true },
      })
    : [];
  const byCode = new Map(items.map((i) => [i.justCode!, i]));
  const rows = (snapshot?.products ?? [])
    .map((p) => {
      const i = byCode.get(p.code);
      return i ? { catalogItemId: i.id, code: p.code, name: i.name, brand: i.bodega, photo: i.photos[0] ?? null, brandedPhotoUrl: i.brandedPhotoUrl, rank: p.rank, unitsRange: p.unitsRange } : null;
    })
    .filter((r) => r !== null);
  return NextResponse.json({ canEdit, rows });
}

const schema = z.object({ catalogItemId: z.string().min(1), url: z.string().url().nullable() });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canBrandNewIds())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const { catalogItemId, url } = parsed.data;
  // Solo fotos subidas a nuestro almacenamiento.
  const storageBase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (url && (!storageBase || !url.startsWith(storageBase))) return NextResponse.json({ error: "La foto no es válida." }, { status: 400 });

  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id: catalogItemId }, select: { id: true } });
  if (!item) return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });
  await prisma.purchaseCatalogItem.update({
    where: { id: catalogItemId },
    data: url ? { brandedPhotoUrl: url, brandedPhotoAt: new Date(), brandedPhotoById: session.user.id } : { brandedPhotoUrl: null, brandedPhotoAt: null, brandedPhotoById: null },
  });
  return NextResponse.json({ ok: true });
}
