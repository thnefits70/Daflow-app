import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEditPayrollRoles } from "@/lib/guards";
import { readIndividualPayrollProof } from "@/lib/payrollTransferAi";

const schema = z.object({ proofUrl: z.string().url() });

// Verificación EN VIVO, no bloqueante — mismo espíritu que
// transfer/verify-proof: deja ver si el comprobante que Nairoby acaba de
// subir coincide con el líquido a pagar de ESE colaborador puntual, antes
// de que confirme. El monto esperado se lee del rol server-side, nunca del
// cliente.
export async function POST(req: NextRequest, { params }: { params: Promise<{ roleId: string }> }) {
  if (!(await canEditPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { roleId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const role = await prisma.payrollQuincenaRole.findUnique({
    where: { id: roleId },
    include: { period: { include: { transfer: true } } },
  });
  if (!role) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (role.period.transfer?.status !== "COMPLETED") {
    return NextResponse.json({ error: "Todavía no se transfirió el total de la quincena." }, { status: 409 });
  }
  const expectedAmount = role.netTotal;

  try {
    const read = await readIndividualPayrollProof({ proofUrl: parsed.data.proofUrl, actorId: session.user.id });
    const amountMatches = read.readAmount !== null && Math.abs(read.readAmount - expectedAmount) < 0.01;
    const matches = amountMatches && !!read.proofNumber;
    const note =
      read.readAmount === null
        ? "No se pudo leer el monto con claridad en el comprobante — subí una imagen más clara."
        : !amountMatches
        ? `Atención — el comprobante muestra $${read.readAmount.toFixed(2)}, pero a esta persona le corresponden $${expectedAmount.toFixed(2)}.`
        : !read.proofNumber
        ? `El monto coincide ($${read.readAmount.toFixed(2)}), pero no se pudo leer el número de comprobante — subí una imagen donde se vea con claridad.`
        : `Coincide — el comprobante muestra $${read.readAmount.toFixed(2)}, N° de comprobante ${read.proofNumber}.`;
    return NextResponse.json({ readAmount: read.readAmount, proofNumber: read.proofNumber, matches, note });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo verificar el comprobante." }, { status: 500 });
  }
}
