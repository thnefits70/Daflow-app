import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEditPayrollRoles } from "@/lib/guards";
import { readIndividualPayrollProof, namesLikelyMatch } from "@/lib/payrollTransferAi";

const schema = z.object({
  proofUrl: z.string().trim().min(1),
  proofName: z.string().trim().min(1),
});

// Confirma el pago a UN colaborador puntual — mismo espíritu bloqueante que
// transfer/proof/route.ts (la verificación de arriba es solo preview de UI,
// esta es la que de verdad marca el pago). Vuelve a leer el comprobante con
// la IA server-side y rechaza si no coincide con el netTotal de este rol.
export async function POST(req: NextRequest, { params }: { params: Promise<{ roleId: string }> }) {
  if (!(await canEditPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { roleId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const role = await prisma.payrollQuincenaRole.findUnique({
    where: { id: roleId },
    include: {
      period: { include: { transfer: true } },
      employee: { select: { employeeBankAccounts: { where: { isSelected: true }, select: { bankAccountHolder: true }, take: 1 } } },
    },
  });
  if (!role) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (role.period.transfer?.status !== "COMPLETED") {
    return NextResponse.json({ error: "Todavía no se transfirió el total de la quincena." }, { status: 409 });
  }

  const expectedAmount = role.netTotal;
  const registeredHolderName = role.employee.employeeBankAccounts[0]?.bankAccountHolder ?? null;
  let readAmount: number | null = null;
  let proofNumber: string | null = null;
  let recipientName: string | null = null;
  try {
    const read = await readIndividualPayrollProof({ proofUrl: parsed.data.proofUrl, actorId: session.user.id });
    readAmount = read.readAmount;
    proofNumber = read.proofNumber;
    recipientName = read.recipientName;
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
            : `El comprobante muestra $${readAmount.toFixed(2)}, pero a esta persona le corresponden $${expectedAmount.toFixed(2)}.`,
      },
      { status: 409 }
    );
  }
  if (!proofNumber) {
    return NextResponse.json(
      { error: "El monto coincide, pero no se pudo leer el número de comprobante — subí una imagen donde se vea con claridad." },
      { status: 409 }
    );
  }
  // Pedido explícito del usuario 2026-08-27 (caso real: comprobante de
  // Robert no coincidía) — además del monto y el número, el nombre del
  // beneficiario tiene que coincidir con el titular de la cuenta que ESE
  // colaborador registró, para evitar subir el comprobante de otra persona.
  // Solo se exige si el colaborador ya tiene una cuenta registrada.
  if (registeredHolderName) {
    if (!recipientName) {
      return NextResponse.json(
        { error: "El monto y el número coinciden, pero no se pudo leer el nombre del beneficiario — subí una imagen donde se vea con claridad." },
        { status: 409 }
      );
    }
    if (!namesLikelyMatch(recipientName, registeredHolderName)) {
      return NextResponse.json(
        { error: `El comprobante es a nombre de "${recipientName}", pero la cuenta registrada de este colaborador es de "${registeredHolderName}" — verificá que sea el comprobante correcto.` },
        { status: 409 }
      );
    }
  }

  const updated = await prisma.payrollQuincenaRole.update({
    where: { id: roleId },
    data: {
      paidAt: new Date(),
      paidProofUrl: parsed.data.proofUrl,
      paidProofName: parsed.data.proofName,
      paidProofReadAmount: readAmount,
      paidProofNumber: proofNumber,
      paidProofRecipientName: recipientName,
    },
  });

  return NextResponse.json(updated);
}

// Deshacer un pago marcado por error (ej. subió el comprobante de otra
// persona por accidente) — solo Nairoby, sin restricción de estado extra
// más allá de poder editar el rol.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ roleId: string }> }) {
  if (!(await canEditPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { roleId } = await params;
  const role = await prisma.payrollQuincenaRole.findUnique({ where: { id: roleId } });
  if (!role) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const updated = await prisma.payrollQuincenaRole.update({
    where: { id: roleId },
    data: { paidAt: null, paidProofUrl: null, paidProofName: null, paidProofReadAmount: null, paidProofNumber: null, paidProofRecipientName: null },
  });

  return NextResponse.json(updated);
}
