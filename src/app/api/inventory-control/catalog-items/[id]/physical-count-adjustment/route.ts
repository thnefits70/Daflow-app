import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManageJustCatalog } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { submitPhysicalCountAdjustment } from "@/lib/stockKardex";
import { prisma } from "@/lib/prisma";

const schema = z.object({ requestedQuantity: z.number().int().min(0), reason: z.string().trim().min(1) });

// Confirmado 2026-09-22, pedido explícito del usuario (admin): único punto
// de entrada para ajustar el stock de INVESTOCK a mano por un conteo
// físico real — mismo permiso que el resto de Stock Actual
// (canManageJustCatalog: admin o Daniel, líder de Inventario). El admin
// aplica el ajuste directo; Daniel solo deja una solicitud pendiente (ver
// submitPhysicalCountAdjustment en stockKardex.ts) — a propósito, para que
// esto no se vuelva un botón de uso diario sin control.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canManageJustCatalog())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const isAdmin = session.user.role === "admin";
  try {
    const result = await submitPhysicalCountAdjustment({
      catalogItemId: id,
      requestedQuantity: parsed.data.requestedQuantity,
      reason: parsed.data.reason,
      isAdmin,
      userId: isAdmin ? null : session.user.id,
    });
    if (result.kind === "requested") {
      const item = await prisma.purchaseCatalogItem.findUnique({ where: { id }, select: { name: true } });
      await notifyOwner("admin", {
        title: "📦 Ajuste de stock por conteo físico",
        body: `Daniel pidió ajustar "${item?.name ?? ""}" a ${parsed.data.requestedQuantity} — ${parsed.data.reason}`,
        url: "/admin",
      });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo procesar el ajuste." }, { status: 409 });
  }
}
