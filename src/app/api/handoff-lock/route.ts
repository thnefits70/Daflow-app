import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getHandoffLock } from "@/lib/handoffLocks";

// Pedido del usuario 2026-10-15 — ver handoffLocks.ts: si la asesora B2B o
// Bryan pasaron su plazo, la pantalla se bloquea con su única tarea.
export async function GET() {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json({ lock: null });
  return NextResponse.json({ lock: await getHandoffLock(session.user.id) });
}
