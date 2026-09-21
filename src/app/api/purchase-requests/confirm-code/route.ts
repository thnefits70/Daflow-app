import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";

const schema = z.object({ catalogItemId: z.string().min(1), code: z.string().trim().min(1) });

// Confirmado 2026-09-21, pedido explícito del usuario: ya no se usará más
// Just, así que cuando una cotización solo trae el código del proveedor (sin
// nombre de producto), ya no hay a quién pedirle una orden de compra de
// respaldo para confirmar qué producto es. En su lugar, quien solicita
// (Jariel) confirma a mano UNA VEZ a qué producto corresponde ese código (con
// doble clic en el formulario, para evitar un error) — y esa relación queda
// guardada aquí mismo, en el catálogo de Compras. La próxima vez que ese
// mismo código aparezca en una cotización, se reconoce solo (ver
// suggestedCatalogItem en verify-quote/route.ts) y no hace falta volver a
// confirmar ni pedir ningún documento extra.
export async function POST(req: NextRequest) {
  if (!(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id: parsed.data.catalogItemId }, select: { id: true, name: true, code: true } });
  if (!item) return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });

  const updated = await prisma.purchaseCatalogItem.update({
    where: { id: item.id },
    data: { code: parsed.data.code.trim() },
    select: { id: true, name: true, code: true },
  });

  return NextResponse.json(updated);
}
