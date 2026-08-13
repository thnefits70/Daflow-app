import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canApproveOvertimeHours } from "@/lib/guards";

// Confirmado 2026-08-13: sin esto, ese día no cuenta para nada del cálculo
// mensual — exclusivo del admin.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canApproveOvertimeHours())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const session = await auth();
  const { id } = await params;
  const entry = await prisma.overtimeEntry.findUnique({ where: { id } });
  if (!entry) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (entry.approvedAt) return NextResponse.json({ error: "Ya estaba aprobada." }, { status: 409 });

  const isAdmin = session!.user.role === "admin";
  const updated = await prisma.overtimeEntry.update({
    where: { id },
    data: { approvedAt: new Date(), approvedById: isAdmin ? null : session!.user.id },
  });
  return NextResponse.json(updated);
}
