import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/guards";
import { attemptAutoPriceOrder } from "@/lib/personalPurchases";
import { notifyOwner } from "@/lib/notifications";

// Confirmado 2026-09-21, pedido explícito del usuario: botón de admin para
// reintentar el precio automático de un pedido que se quedó esperando costo
// (ver awaiting-cost/route.ts) — por ejemplo apenas Daniel termina de cargar
// el costo de ese producto en INVESTOCK. Usa la misma función que ya corre
// sola al confirmar bodega (attemptAutoPriceOrder); si el producto todavía
// no tiene costo, no cambia nada y avisa que sigue faltando.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const result = await attemptAutoPriceOrder(id);
  if (!result.priced) return NextResponse.json({ error: "Todavía falta costo de INVESTOCK para algún producto de este pedido." }, { status: 409 });

  await notifyOwner(result.employeeId, {
    title: "💵 Tu compra personal quedó lista",
    body: `Total $${result.totalAmount.toFixed(2)} — elegí cómo pagarla.`,
    url: "/area/compras-personales",
  });

  return NextResponse.json({ ok: true, totalAmount: result.totalAmount });
}
