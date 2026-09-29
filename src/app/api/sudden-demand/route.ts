import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { dbUserId } from "@/lib/guards";
import { canViewSuddenDemand, canWriteSuddenDemandNote, getSuddenDemandCards, SUDDEN_DEMAND_START_DAY } from "@/lib/suddenDemand";

// "Productos que despiertan" (pedido de Daniel 2026-09-29): Daniel, Jariel,
// Bryan Rios, Heidy, Yair, Nairoby y el admin. Muestra los activos y los de
// los últimos 30 días.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const isAdmin = session.user.role === "admin";
  const userId = dbUserId(session.user.id);
  if (!isAdmin && !(userId && (await canViewSuddenDemand(userId)))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const [data, canWriteNote] = await Promise.all([getSuddenDemandCards({ historyDays: 30 }), canWriteSuddenDemandNote(userId, isAdmin)]);
  return NextResponse.json({ ...data, canWriteNote, startDay: SUDDEN_DEMAND_START_DAY });
}
