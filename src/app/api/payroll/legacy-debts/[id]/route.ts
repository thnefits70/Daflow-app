import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageLegacyPayrollDebts } from "@/lib/guards";

// Confirmado 2026-09-11: pedido explícito del usuario — Nairoby puede
// borrar una deuda cargada por error. Solo afecta cuotas futuras: las
// líneas de rol ya generadas en períodos pasados no se recalculan (mismo
// criterio que el resto de buildAutomaticLineItems), así que borrar acá
// nunca cambia un rol de pago ya generado.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageLegacyPayrollDebts())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  await prisma.legacyPayrollDebt.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
