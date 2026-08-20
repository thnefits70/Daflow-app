import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManageSalaryAdvances } from "@/lib/guards";
import { readSalaryAdvanceProof } from "@/lib/salaryAdvanceAi";

const schema = z.object({
  proofUrl: z.string().url(),
  expectedAmount: z.number().positive(),
});

// Mismo patrón que /api/petty-cash/verify-proof: verificación EN VIVO antes
// de aprobar y transferir, para poder cambiar la foto a tiempo si no coincide.
export async function POST(req: NextRequest) {
  if (!(await canManageSalaryAdvances())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const d = parsed.data;

  try {
    const read = await readSalaryAdvanceProof({ proofUrl: d.proofUrl, actorId: session.user.id, deptId: session.user.deptId ?? undefined });
    const matches = read.readAmount !== null && Math.abs(read.readAmount - d.expectedAmount) < 0.01;
    const note =
      read.readAmount === null
        ? "No se pudo leer el monto con claridad en la foto — sube una imagen más clara."
        : matches
        ? `Coincide — el comprobante muestra $${read.readAmount.toFixed(2)}.`
        : `Rechazado — el comprobante muestra $${read.readAmount.toFixed(2)}, pero el anticipo es de $${d.expectedAmount.toFixed(2)}.`;
    return NextResponse.json({ readAmount: read.readAmount, matches, note });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo verificar el comprobante." }, { status: 500 });
  }
}
