import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageSalaryAdvances } from "@/lib/guards";

// Historial completo (todas las áreas) de anticipos ya resueltos —
// solo lectura, mismo criterio de acceso que la aprobación de anticipos.
export async function GET() {
  if (!(await canManageSalaryAdvances())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const advances = await prisma.salaryAdvance.findMany({
    where: { status: { in: ["APPROVED", "REJECTED"] } },
    include: { employee: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json(advances);
}
