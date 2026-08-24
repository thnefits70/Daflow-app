import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewPayrollRoles } from "@/lib/guards";

const MONTH_RE = /^\d{4}-\d{2}$/;

// Confirmado 2026-08-24: pedido explícito del usuario — un registro interno
// (Nairoby/admin, nunca el colaborador) de los pagos individuales que se
// van confirmando cada mes, para poder revisar de un vistazo quién quedó
// pagado en cada quincena sin tener que entrar período por período.
export async function GET(req: NextRequest) {
  if (!(await canViewPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!MONTH_RE.test(month)) return NextResponse.json({ error: "Mes inválido." }, { status: 400 });

  const periods = await prisma.payrollPeriod.findMany({
    where: { period: { in: [`${month}-Q1`, `${month}-Q2`] } },
    include: {
      roles: {
        where: { isCurrent: true },
        orderBy: { employee: { name: "asc" } },
        select: {
          id: true,
          netTotal: true,
          paidAt: true,
          paidProofUrl: true,
          paidProofName: true,
          employee: { select: { id: true, name: true, position: true } },
        },
      },
    },
  });

  const entries = periods.flatMap((p) =>
    p.roles.map((r) => ({
      roleId: r.id,
      period: p.period,
      quincena: p.period.endsWith("-Q1") ? "1-15" : "16-fin",
      employeeName: r.employee.name,
      position: r.employee.position,
      netTotal: r.netTotal,
      paidAt: r.paidAt,
      paidProofUrl: r.paidProofUrl,
      paidProofName: r.paidProofName,
    }))
  );
  entries.sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.period.localeCompare(b.period));

  return NextResponse.json({ month, entries });
}
