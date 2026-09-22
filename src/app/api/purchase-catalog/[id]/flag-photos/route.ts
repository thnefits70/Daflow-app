import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

const schema = z.object({ reason: z.string().trim().optional() });

// Confirmado 2026-09-22: cuando un producto ya tiene compras registradas,
// PATCH en [id]/route.ts bloquea el cambio de fotos para todos menos el
// admin — este endpoint solo le avisa que hace falta revisarlo, para que
// entre él mismo bajo su propio usuario y decida el cambio.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canSubmitPurchaseRequests()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "Producto, mercadería o insumo no encontrado." }, { status: 404 });

  const inUse = await prisma.purchaseRequest.count({ where: { catalogItemId: id } });
  if (inUse === 0) {
    return NextResponse.json(
      { error: "Este producto no tiene compras registradas todavía — puedes editar las fotos directamente." },
      { status: 400 }
    );
  }

  await notifyOwner("admin", {
    title: "📸 Corrección de fotos pendiente",
    body: `"${item.name}" ya tiene compras registradas — solo tú puedes corregir sus fotos.${parsed.data.reason ? ` — ${parsed.data.reason}` : ""}`,
    url: "/admin",
  });

  return NextResponse.json({ ok: true });
}
