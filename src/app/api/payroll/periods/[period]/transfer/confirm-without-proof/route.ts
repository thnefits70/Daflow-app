import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, getFinanceLeadId } from "@/lib/guards";
import { isValidPeriod } from "@/lib/payroll";
import { notifyOwner } from "@/lib/notifications";

const schema = z.object({ note: z.string().trim().max(500).optional() });

// Pedido explícito del usuario 2026-08-27: cuando la cuenta destino es del
// propio admin (ADMIN_COMPANY o ADMIN_PRODUBANCO), subir un comprobante de
// una transferencia que se hizo a sí mismo es fricción sin sentido. Esto
// completa la transferencia sin foto, pero deja constancia de quién hizo el
// clic y a qué hora — la "firma" que reemplaza al comprobante.
export async function POST(req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({ where: { period }, include: { transfer: true } });
  if (!payrollPeriod?.transfer) return NextResponse.json({ error: "Todavía no hay una transferencia propuesta para este período." }, { status: 404 });
  if (payrollPeriod.transfer.status !== "APPROVED") {
    return NextResponse.json({ error: "Primero hay que aprobarla." }, { status: 409 });
  }
  if (payrollPeriod.transfer.destination !== "ADMIN_COMPANY" && payrollPeriod.transfer.destination !== "ADMIN_PRODUBANCO") {
    return NextResponse.json({ error: "Solo se puede confirmar sin comprobante cuando la cuenta destino es propia." }, { status: 409 });
  }

  const updated = await prisma.payrollTransfer.update({
    where: { id: payrollPeriod.transfer.id },
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
      title: "✅ El admin ya transfirió la nómina",
      body: `Quincena ${period} — $${updated.totalAmount.toFixed(2)} transferido, confirmado sin comprobante (cuenta propia). Ya podés publicar.`,
      url: "/area/nomina?tab=pagos&ptab=roles",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
