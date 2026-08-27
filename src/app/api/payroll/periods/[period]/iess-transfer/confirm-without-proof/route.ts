import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, getFinanceLeadId } from "@/lib/guards";
import { isValidPeriod } from "@/lib/payroll";
import { notifyOwner } from "@/lib/notifications";

const schema = z.object({ note: z.string().trim().max(500).optional() });

// Mismo patrón que /transfer/confirm-without-proof/route.ts — ver ahí.
export async function POST(req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({ where: { period }, include: { iessTransfer: true } });
  if (!payrollPeriod?.iessTransfer) return NextResponse.json({ error: "Todavía no hay una transferencia de IESS propuesta para este período." }, { status: 404 });
  if (payrollPeriod.iessTransfer.status !== "APPROVED") {
    return NextResponse.json({ error: "Primero hay que aprobarla." }, { status: 409 });
  }
  if (payrollPeriod.iessTransfer.destination !== "ADMIN_COMPANY" && payrollPeriod.iessTransfer.destination !== "ADMIN_PRODUBANCO") {
    return NextResponse.json({ error: "Solo se puede confirmar sin comprobante cuando la cuenta destino es propia." }, { status: 409 });
  }

  const updated = await prisma.payrollIessTransfer.update({
    where: { id: payrollPeriod.iessTransfer.id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      confirmedWithoutProof: true,
      confirmedWithoutProofNote: parsed.data.note || null,
      confirmedWithoutProofAt: new Date(),
      confirmedWithoutProofByName: session.user.name,
    },
  });

  const financeLeadId = await getFinanceLeadId();
  if (financeLeadId) {
    await notifyOwner(financeLeadId, {
      title: "✅ El admin ya transfirió el IESS",
      body: `Quincena ${period} — $${updated.totalAmount.toFixed(2)} transferido, confirmado sin comprobante (cuenta propia).`,
      url: "/area/nomina?tab=pagos&ptab=roles",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
