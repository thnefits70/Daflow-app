import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, getFinanceLeadId } from "@/lib/guards";
import { isValidPeriod } from "@/lib/payroll";
import { notifyOwner, resolveNotifications } from "@/lib/notifications";

const schema = z.object({ reason: z.string().trim().min(1, "Contá el motivo del rechazo.") });

export async function POST(req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({ where: { period }, include: { iessTransfer: true } });
  if (!payrollPeriod?.iessTransfer) return NextResponse.json({ error: "Todavía no hay una transferencia de IESS propuesta para este período." }, { status: 404 });
  if (payrollPeriod.iessTransfer.status !== "PENDING_APPROVAL") {
    return NextResponse.json({ error: "Ya no está pendiente de aprobación." }, { status: 409 });
  }

  const updated = await prisma.payrollIessTransfer.update({
    where: { id: payrollPeriod.iessTransfer.id },
    data: { status: "REJECTED", rejectionReason: parsed.data.reason.trim(), rejectedAt: new Date() },
  });
  await resolveNotifications("admin", "🔔 Nairoby te envió el total de IESS", `Quincena ${period}`);

  const financeLeadId = await getFinanceLeadId();
  if (financeLeadId) {
    await notifyOwner(financeLeadId, {
      title: "🔔 El admin rechazó la transferencia de IESS",
      body: `Quincena ${period} — ${parsed.data.reason.trim()}`,
      url: "/area/nomina?tab=pagos&ptab=roles",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
