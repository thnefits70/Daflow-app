import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, dbUserId } from "@/lib/guards";

const schema = z.object({ catalogItemId: z.string().min(1) });

// Confirmado 2026-09-10 (pedido explícito del usuario): vincula por PRIMERA
// VEZ un item histórico (de antes del 2026-08-29) que quedó con
// catalogItemId null — nunca reemplaza un vínculo que ya existe, por eso
// exige item.catalogItemId === null (409 si no). No toca approvedAt ni
// closedAt: el item se queda tal como estaba, solo gana su conexión al
// catálogo real (y por lo tanto su código de Just/Dropi, si el producto ya
// lo tiene). Exclusivo de admin — ver legacy-unlinked/route.ts para el
// razonamiento completo de por qué esta excepción puntual no afloja la
// regla de "un vínculo aprobado nunca se toca" (relink/route.ts) para el
// resto del sistema.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const item = await prisma.merchandiseReentryItem.findUnique({ where: { id }, select: { catalogItemId: true } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (item.catalogItemId) return NextResponse.json({ error: "Este producto ya está vinculado — usa la corrección normal, no esta herramienta." }, { status: 409 });

  const catalogItem = await prisma.purchaseCatalogItem.findUnique({ where: { id: parsed.data.catalogItemId }, select: { id: true } });
  if (!catalogItem) return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });

  const updated = await prisma.merchandiseReentryItem.update({
    where: { id },
    data: {
      catalogItemId: catalogItem.id,
      aiRecognized: true,
      correctedById: dbUserId(session.user.id),
      correctedAt: new Date(),
    },
  });

  return NextResponse.json(updated);
}
