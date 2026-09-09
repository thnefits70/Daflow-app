import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageAdminPayments } from "@/lib/guards";

const patchSchema = z.object({ contractAccountNumber: z.string().trim().min(1).nullable() });

// Confirmado 2026-09-09: pedido explícito del usuario — comprobantes
// subidos ANTES del fix de "Cuenta contrato" (09f2e22, 2026-09-08) quedaron
// con contractAccountNumber en null porque la IA todavía no leía ese campo.
// Corrección manual puntual: no vuelve a llamar a la IA, solo guarda el
// número tal como lo escribe quien lo mira en la imagen. Mismo criterio de
// permisos que iessReceiptNumber (dato operativo, no exclusivo de admin).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ proofId: string }> }) {
  if (!(await canManageAdminPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { proofId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const proof = await prisma.adminPaymentProof.findUnique({ where: { id: proofId } });
  if (!proof) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const updated = await prisma.adminPaymentProof.update({
    where: { id: proofId },
    data: { contractAccountNumber: parsed.data.contractAccountNumber },
  });
  return NextResponse.json(updated);
}
