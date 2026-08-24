import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, getFinanceLeadId } from "@/lib/guards";
import { isValidPeriod } from "@/lib/payroll";
import { notifyOwner } from "@/lib/notifications";

const schema = z.object({
  proofUrl: z.string().trim().min(1),
  proofName: z.string().trim().min(1),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({ where: { period }, include: { transfer: true } });
  if (!payrollPeriod?.transfer) return NextResponse.json({ error: "Todavía no hay una transferencia propuesta para este período." }, { status: 404 });
  if (payrollPeriod.transfer.status !== "APPROVED") {
    return NextResponse.json({ error: "Primero hay que aprobarla." }, { status: 409 });
  }

  const updated = await prisma.payrollTransfer.update({
    where: { id: payrollPeriod.transfer.id },
    data: { status: "COMPLETED", proofUrl: parsed.data.proofUrl, proofName: parsed.data.proofName, completedAt: new Date() },
  });

  const financeLeadId = await getFinanceLeadId();
  if (financeLeadId) {
    await notifyOwner(financeLeadId, {
      title: "✅ El admin ya transfirió la nómina",
      body: `Quincena ${period} — $${updated.totalAmount.toFixed(2)} transferido, comprobante subido. Ya podés publicar.`,
      url: "/area/nomina?tab=pagos&ptab=roles",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
