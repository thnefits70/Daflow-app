import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canApproveOvertimeHours } from "@/lib/guards";

// Rechazar = el día nunca llegó a contar para nada (mismo criterio que no
// aprobar), pero el registro queda (rejectedAt) en vez de borrarse, para
// que el líder que lo cargó, el admin y Nairoby puedan ver el historial.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canApproveOvertimeHours())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const entry = await prisma.overtimeEntry.findUnique({ where: { id } });
  if (!entry) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (entry.approvedAt) return NextResponse.json({ error: "Ya estaba aprobada." }, { status: 409 });
  if (entry.rejectedAt) return NextResponse.json({ error: "Ya estaba rechazada." }, { status: 409 });

  const updated = await prisma.overtimeEntry.update({
    where: { id },
    data: { rejectedAt: new Date(), rejectedById: null },
  });
  return NextResponse.json(updated);
}
