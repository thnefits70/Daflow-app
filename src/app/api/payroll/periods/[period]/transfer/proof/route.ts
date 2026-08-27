import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, getFinanceLeadId } from "@/lib/guards";
import { isValidPeriod } from "@/lib/payroll";
import { notifyOwner } from "@/lib/notifications";
import { readPayrollTransferProof } from "@/lib/payrollTransferAi";

const schema = z.object({
  proofUrl: z.string().trim().min(1),
  proofName: z.string().trim().min(1),
});

// Confirmado tras un caso real (2026-08-24): la verificación de
// /transfer/verify-proof es solo una previsualización en vivo para la UI —
// no bloqueaba nada de verdad, así que un comprobante de $3 se pudo
// confirmar como si fueran los $3035.63 esperados. Ahora este endpoint,
// que es el que de verdad completa la transferencia, vuelve a leer el
// comprobante con la IA y rechaza si no coincide — mismo espíritu
// bloqueante que /api/admin-payments/[id]/upload-proof.
export async function POST(req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

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

  const expectedAmount = payrollPeriod.transfer.totalAmount;
  let readAmount: number | null = null;
  let proofNumber: string | null = null;
  try {
    const read = await readPayrollTransferProof({ proofUrl: parsed.data.proofUrl, actorId: session.user.id });
    readAmount = read.readAmount;
    proofNumber = read.proofNumber;
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
  // Pedido explícito del usuario 2026-08-27: el monto correcto no alcanza —
  // también se exige haber podido leer el número de comprobante antes de
  // dejar confirmar, para que quede una referencia numerada del pago.
  if (!proofNumber) {
    return NextResponse.json(
      { error: "El monto coincide, pero no se pudo leer el número de comprobante — subí una imagen donde se vea con claridad." },
      { status: 409 }
    );
  }

  const updated = await prisma.payrollTransfer.update({
    where: { id: payrollPeriod.transfer.id },
    data: { status: "COMPLETED", proofUrl: parsed.data.proofUrl, proofName: parsed.data.proofName, proofNumber, completedAt: new Date() },
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
