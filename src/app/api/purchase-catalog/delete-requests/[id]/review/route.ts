import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

const schema = z.object({ action: z.enum(["approve", "reject"]) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const deleteRequest = await prisma.purchaseCatalogItemDeleteRequest.findUnique({ where: { id } });
  if (!deleteRequest) return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });

  if (parsed.data.action === "reject") {
    await prisma.purchaseCatalogItemDeleteRequest.delete({ where: { id } });
    return NextResponse.json({ ok: true, deleted: false });
  }

  // Un insumo con historial de compras no se puede borrar de verdad (rompería
  // el rastro de auditoría) — se avisa en vez de dejar que la base de datos
  // reviente con un error de llave foránea.
  const inUse = await prisma.purchaseRequest.count({ where: { catalogItemId: deleteRequest.itemId } });
  if (inUse > 0) {
    return NextResponse.json(
      { error: "Este insumo ya tiene compras registradas — no se puede eliminar sin perder ese historial." },
      { status: 409 }
    );
  }

  await prisma.$transaction([
    prisma.purchaseCatalogItemDeleteRequest.delete({ where: { id } }),
    prisma.purchaseCatalogItem.delete({ where: { id: deleteRequest.itemId } }),
  ]);
  return NextResponse.json({ ok: true, deleted: true });
}
