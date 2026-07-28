import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Confirmado 2026-07-28: ampliado a CUALQUIER persona autenticada — antes
// solo admin/líder podían tener algo en "Pendientes", pero ahora cualquiera
// en Nómina puede crear sus propios "Recordatorios" personales con push
// (ver PeriodicReminder.notifyPush), así que cualquiera puede terminar
// recibiendo una notificación, no solo admin/líderes.
export async function GET() {
  const session = await auth();
  return NextResponse.json({ eligible: !!session });
}
