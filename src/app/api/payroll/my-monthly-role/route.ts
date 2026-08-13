import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Confirmado 2026-08-13: cada colaborador ve SOLO lo suyo — nunca lo de
// nadie más, y nunca el detalle real quincenal (PayrollQuincenaRole), solo
// esto. Devuelve todas las versiones (para el historial), la última
// primero dentro de cada mes.
export async function GET() {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const roles = await prisma.monthlyLegalRole.findMany({
    where: { employeeId: session.user.id },
    orderBy: [{ month: "desc" }, { version: "desc" }],
  });
  return NextResponse.json(roles);
}
