import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canConfirmFulfillmentLot } from "@/lib/guards";
import {
  COUNTED_LOT_GRACE_HOURS,
  getCountedUnconfirmedLots,
  isCountedLotsGateSnoozed,
  overdueCountedLots,
  submitCountedLotsDelayReason,
} from "@/lib/fulfillmentPicking";

// Pedido del usuario 2026-10-01: pantalla que Daniel no puede saltarse si un
// corte contado lleva más de 24 horas sin confirmar.
export async function GET() {
  const session = await auth();
  if (!session || !(await canConfirmFulfillmentLot())) return NextResponse.json({ show: false });
  // Siempre devuelve la lista (la usa también el aviso de la pantalla de
  // cortes); show solo decide si sale la pantalla que no se salta.
  const lots = await getCountedUnconfirmedLots();
  const overdue = overdueCountedLots(lots);
  const show = overdue.length > 0 && !(await isCountedLotsGateSnoozed());
  return NextResponse.json({
    show,
    graceHours: COUNTED_LOT_GRACE_HOURS,
    lots: lots.map((l) => ({ ...l, readySince: l.readySince.toISOString(), overdue: overdue.some((o) => o.id === l.id) })),
  });
}

const schema = z.object({ reason: z.string().trim().min(5).max(500) });

// "Todavía no": el motivo le llega al admin y la pantalla descansa unas horas.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canConfirmFulfillmentLot())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Escribe el motivo (mínimo 5 letras)." }, { status: 400 });
  await submitCountedLotsDelayReason(parsed.data.reason);
  return NextResponse.json({ ok: true });
}
