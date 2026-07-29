import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { getCatalogItemPriceStats } from "@/lib/purchases";

export async function GET(req: NextRequest) {
  if (!(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const withStats = req.nextUrl.searchParams.get("withStats") === "1";
  const items = await prisma.purchaseCatalogItem.findMany({
    orderBy: { name: "asc" },
    include: { deleteRequest: { select: { id: true } } },
  });

  if (!withStats) {
    return NextResponse.json(items.map((i) => ({ id: i.id, name: i.name, photos: i.photos, hasPendingDelete: !!i.deleteRequest })));
  }

  const withStatsData = await Promise.all(
    items.map(async (i) => ({
      id: i.id,
      name: i.name,
      photos: i.photos,
      hasPendingDelete: !!i.deleteRequest,
      stats: await getCatalogItemPriceStats(i.id),
    }))
  );
  return NextResponse.json(withStatsData);
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Falta el nombre del insumo."),
  photos: z.array(z.string().url()).min(1, "Agrega al menos una foto del producto.").max(3),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canSubmitPurchaseRequests()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  // Chequeo de exactitud del lado del servidor — el frontend ya avisa antes
  // de llegar aquí, pero esto es lo que de verdad lo impide.
  const existing = await prisma.purchaseCatalogItem.findFirst({
    where: { name: { equals: parsed.data.name, mode: "insensitive" } },
  });
  if (existing) {
    return NextResponse.json(
      { error: `Ya existe "${existing.name}" en el catálogo — selecciónalo en vez de crear uno nuevo.`, existingId: existing.id },
      { status: 409 }
    );
  }

  const isAdmin = session.user.role === "admin";
  const item = await prisma.purchaseCatalogItem.create({
    data: { name: parsed.data.name, photos: parsed.data.photos, createdById: isAdmin ? null : session.user.id },
  });
  return NextResponse.json(item, { status: 201 });
}
