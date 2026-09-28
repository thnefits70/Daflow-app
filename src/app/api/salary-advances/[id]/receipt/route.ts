import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { actorName } from "@/lib/actorName";
import { salaryAdvanceNeedsReceipt } from "@/lib/payroll";

const schema = z.object({ received: z.boolean() });

// Confirmado 2026-09-28: el propio colaborador confirma con un clic que le
// llegó el anticipo (o avisa que no). Solo el dueño del anticipo.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const advance = await prisma.salaryAdvance.findUnique({ where: { id } });
  if (!advance || advance.employeeId !== session.user.id) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!salaryAdvanceNeedsReceipt(advance)) return NextResponse.json({ error: "Este anticipo ya fue confirmado." }, { status: 409 });

  const who = actorName(session.user.name);
  if (parsed.data.received) {
    await prisma.salaryAdvance.update({ where: { id }, data: { receiptConfirmedAt: new Date() } });
    await notifyOwner("admin", {
      title: "✅ Anticipo recibido",
      body: `${who} confirmó que le llegó el anticipo de $${advance.amount.toFixed(2)}.`,
      url: "/admin/nomina?tab=pagos&ptab=anticipos",
    }).catch(() => null);
  } else {
    if (advance.receiptIssueReportedAt) return NextResponse.json({ ok: true });
    await prisma.salaryAdvance.update({ where: { id }, data: { receiptIssueReportedAt: new Date() } });
    await notifyOwner("admin", {
      title: "⚠️ Anticipo NO recibido",
      body: `${who} dice que NO le llegó el anticipo de $${advance.amount.toFixed(2)}. Revisá la transferencia.`,
      url: "/admin/nomina?tab=pagos&ptab=anticipos",
    }).catch(() => null);
  }
  return NextResponse.json({ ok: true });
}
