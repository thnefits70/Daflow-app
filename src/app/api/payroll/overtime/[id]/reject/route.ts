import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canApproveOvertimeHours } from "@/lib/guards";

// Rechazar = el día nunca llegó a contar para nada (mismo criterio que no
// aprobar), así que simplemente se borra el registro pendiente.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canApproveOvertimeHours())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const entry = await prisma.overtimeEntry.findUnique({ where: { id } });
  if (!entry) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (entry.approvedAt) return NextResponse.json({ error: "Ya estaba aprobada." }, { status: 409 });

  await prisma.overtimeEntry.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
