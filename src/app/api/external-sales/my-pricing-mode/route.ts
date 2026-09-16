import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canDeclareExternalSales } from "@/lib/guards";

// Confirmado 2026-09-14: el formulario de declarar venta necesita saber, ANTES
// de mostrar nada, si el asesor logueado vende B2B (pago anticipado, elige
// margen) o B2C (contra entrega/Marcos, margen automático) — mismo dato que
// ya usa el backend para congelar ExternalSale.isContraEntrega al declarar.
//
// Confirmado 2026-09-16, pedido de Marcos: canOverride avisa al formulario si
// puede mostrar el selector "con recaudo / sin recaudo" por venta — solo los
// asesores con externalSaleContraEntrega=true en su perfil lo ven, el resto
// sigue siempre en modo B2B sin selector, igual que antes.
export async function GET() {
  const session = await auth();
  if (!(await canDeclareExternalSales()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const advisor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { externalSaleContraEntrega: true } });
  const canOverride = !!advisor?.externalSaleContraEntrega;
  return NextResponse.json({ isContraEntrega: canOverride, canOverride });
}
