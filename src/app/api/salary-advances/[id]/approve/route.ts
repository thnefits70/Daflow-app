import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canManageSalaryAdvances } from "@/lib/guards";
import { resolveFirstPayoutMonth } from "@/lib/payroll";
import { nowInEcuador, addMonthsToMonthStr } from "@/lib/payrollCalc";
import { notifyOwner } from "@/lib/notifications";

const schema = z.object({ transferProofUrl: z.string().min(1, "Subí el comprobante de transferencia.") });

// Confirmado 2026-08-18: admin aprueba, sube el comprobante, y ahí arranca
// el calendario de cuotas — mismo desfase de un mes, empezando el mes
// siguiente a la aprobación (no hay "mes de origen" como en las compras).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageSalaryAdvances())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const session = await auth();
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const advance = await prisma.salaryAdvance.findUnique({ where: { id } });
  if (!advance) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (advance.status !== "PENDING") return NextResponse.json({ error: "Ya fue procesado." }, { status: 409 });

  const now = nowInEcuador();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const naturalFirstMonth = addMonthsToMonthStr(currentMonth, 1);
  const firstPayoutMonth = await resolveFirstPayoutMonth(naturalFirstMonth);

  const isAdmin = session!.user.role === "admin";
  const updated = await prisma.salaryAdvance.update({
    where: { id },
    data: {
      status: "APPROVED",
      transferProofUrl: parsed.data.transferProofUrl,
      approvedAt: new Date(),
      approvedById: isAdmin ? null : session!.user.id,
      firstPayoutMonth,
    },
  });

  await notifyOwner(advance.employeeId, {
    title: "✅ Tu anticipo fue aprobado",
    body: `$${advance.amount.toFixed(2)} — ya se transfirió. Se empieza a descontar en ${firstPayoutMonth}.`,
    url: "/area/anticipos",
  }).catch(() => null);

  return NextResponse.json(updated);
}
