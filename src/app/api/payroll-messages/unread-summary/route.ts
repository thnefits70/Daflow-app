import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManagePayroll } from "@/lib/guards";

// Cuántos mensajes sin leer tiene cada colaborador en su hilo (enviados POR
// el colaborador, no vistos por quien gestiona la nómina) — para mostrar un
// puntito de "sin leer" por fila en el roster de Roles de pago.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!(await canManagePayroll())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  // Prisma no compara dos columnas de la misma fila en un `where` — se trae
  // lo no leído y se filtra "enviado por el propio colaborador" en JS (el
  // volumen de mensajes sin leer siempre será chico).
  const unread = await prisma.payrollMessage.findMany({
    where: { readAt: null },
    select: { employeeId: true, senderId: true },
  });

  const counts: Record<string, number> = {};
  for (const m of unread) {
    if (m.senderId === m.employeeId) counts[m.employeeId] = (counts[m.employeeId] ?? 0) + 1;
  }

  return NextResponse.json(counts);
}
