import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Confirmado 2026-07-28: el aviso de "activar notificaciones" solo debe
// verlo quien alguna vez podría tener algo en "Pendientes" (admin o un
// líder con área a cargo) — no tiene sentido pedirle el permiso a alguien
// que nunca va a recibir un aviso. A diferencia de /api/pending-tasks (que
// también responde vacío cuando no hay NADA pendiente ahora mismo), esto
// solo mira si la persona es del tipo correcto, sin importar si hoy tiene
// algo pendiente o no — el banner debe verse desde antes de que algo se
// atrase, no solo cuando ya hay un pendiente real.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ eligible: false });
  if (session.user.role === "admin") return NextResponse.json({ eligible: true });

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDeptId: true },
  });
  return NextResponse.json({ eligible: !!me?.isLeader && !!me.leadsDeptId });
}
