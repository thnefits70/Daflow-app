import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManagePettyCashPrincipal, canManagePettyCashSecundaria } from "@/lib/guards";
import { readPettyCashProof } from "@/lib/pettyCashAi";

const schema = z.object({
  boxType: z.enum(["PRINCIPAL", "SECUNDARIA"]),
  proofUrl: z.string().url(),
  expectedAmount: z.number().positive(),
});

// Confirmado 2026-08-06: verificación EN VIVO antes de guardar — mismo
// patrón que Control de Compras/Pagos administrativos. Las rutas de
// creación (entries, recharge) también bloquean si el mismatch queda
// confirmado; esto solo deja ver el resultado antes de enviar, para poder
// cambiar la foto a tiempo.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const d = parsed.data;

  const authorized = d.boxType === "PRINCIPAL" ? await canManagePettyCashPrincipal() : await canManagePettyCashSecundaria();
  if (!authorized) return NextResponse.json({ error: "No autorizado para esta caja." }, { status: 403 });

  try {
    const read = await readPettyCashProof({ proofUrl: d.proofUrl, actorId: session.user.id, deptId: session.user.deptId ?? undefined });
    const matches = read.readAmount !== null && Math.abs(read.readAmount - d.expectedAmount) < 0.01;
    const note =
      read.readAmount === null
        ? "No se pudo leer el monto con claridad en la foto — sube una imagen más clara."
        : matches
        ? `Coincide — el comprobante muestra $${read.readAmount.toFixed(2)}.`
        : `Rechazado — el comprobante muestra $${read.readAmount.toFixed(2)}, pero ingresaste $${d.expectedAmount.toFixed(2)}.`;
    return NextResponse.json({ readAmount: read.readAmount, matches, note });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo verificar el comprobante." }, { status: 500 });
  }
}
