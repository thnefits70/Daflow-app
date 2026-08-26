import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";
import { isValidPeriod } from "@/lib/payroll";
import { readIessTransferProof } from "@/lib/payrollTransferAi";

const schema = z.object({ proofUrl: z.string().url() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({ where: { period }, include: { iessTransfer: true } });
  if (!payrollPeriod?.iessTransfer) return NextResponse.json({ error: "Todavía no hay una transferencia de IESS propuesta para este período." }, { status: 404 });
  const expectedAmount = payrollPeriod.iessTransfer.totalAmount;

  try {
    const read = await readIessTransferProof({ proofUrl: parsed.data.proofUrl, actorId: session.user.id });
    const matches = read.readAmount !== null && Math.abs(read.readAmount - expectedAmount) < 0.01;
    const note =
      read.readAmount === null
        ? "No se pudo leer el monto con claridad en el comprobante — subí una imagen más clara."
        : matches
        ? `Coincide — el comprobante muestra $${read.readAmount.toFixed(2)}.`
        : `Atención — el comprobante muestra $${read.readAmount.toFixed(2)}, pero el total a transferir es $${expectedAmount.toFixed(2)}.`;
    return NextResponse.json({ readAmount: read.readAmount, matches, note });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo verificar el comprobante." }, { status: 500 });
  }
}
