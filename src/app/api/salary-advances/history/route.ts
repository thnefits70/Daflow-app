import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewSalaryAdvancesHistory } from "@/lib/guards";

// Historial completo (todas las áreas) de anticipos ya resueltos —
// solo lectura. Admin y Nairoby (líder de Finanzas) lo ven igual; aprobar
// o ver la cola de pendientes con datos bancarios sigue siendo exclusivo
// del admin vía canManageSalaryAdvances.
export async function GET() {
  if (!(await canViewSalaryAdvancesHistory())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const advances = await prisma.salaryAdvance.findMany({
    where: { status: { in: ["APPROVED", "REJECTED"] } },
    include: { employee: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json(advances);
}
