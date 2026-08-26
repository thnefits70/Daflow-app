import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, getFinanceLeadId } from "@/lib/guards";
import { isValidPeriod } from "@/lib/payroll";
import { notifyOwner } from "@/lib/notifications";
import { readIessTransferProof } from "@/lib/payrollTransferAi";

const schema = z.object({
  proofUrl: z.string().trim().min(1),
  proofName: z.string().trim().min(1),
});

// Mismo espíritu bloqueante que /transfer/proof/route.ts (caso real
// 2026-08-24: la verificación en vivo no bastaba, había que volver a leer
// acá) — para el total aparte de IESS.
export async function POST(req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({ where: { period }, include: { iessTransfer: true } });
  if (!payrollPeriod?.iessTransfer) return NextResponse.json({ error: "Todavía no hay una transferencia de IESS propuesta para este período." }, { status: 404 });
  if (payrollPeriod.iessTransfer.status !== "APPROVED") {
    return NextResponse.json({ error: "Primero hay que aprobarla." }, { status: 409 });
  }

  const expectedAmount = payrollPeriod.iessTransfer.totalAmount;
  let readAmount: number | null = null;
  try {
    const read = await readIessTransferProof({ proofUrl: parsed.data.proofUrl, actorId: session.user.id });
    readAmount = read.readAmount;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo verificar el comprobante." }, { status: 500 });
  }
  const matches = readAmount !== null && Math.abs(readAmount - expectedAmount) < 0.01;
  if (!matches) {
    return NextResponse.json(
      {
        error:
          readAmount === null
            ? "No se pudo leer el monto con claridad en el comprobante — subí una imagen más clara."
            : `El comprobante muestra $${readAmount.toFixed(2)}, pero el total a transferir es $${expectedAmount.toFixed(2)}.`,
      },
      { status: 409 }
    );
  }

  const updated = await prisma.payrollIessTransfer.update({
    where: { id: payrollPeriod.iessTransfer.id },
    data: { status: "COMPLETED", proofUrl: parsed.data.proofUrl, proofName: parsed.data.proofName, completedAt: new Date() },
  });

  const financeLeadId = await getFinanceLeadId();
  if (financeLeadId) {
    await notifyOwner(financeLeadId, {
      title: "✅ El admin ya transfirió el IESS",
      body: `Quincena ${period} — $${updated.totalAmount.toFixed(2)} transferido, comprobante subido.`,
      url: "/area/nomina?tab=pagos&ptab=roles",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
