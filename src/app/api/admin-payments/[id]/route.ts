import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageAdminPayments } from "@/lib/guards";

// Confirmado 2026-08-06: si la solicitud ya tiene CUALQUIER archivo cargado
// (doc. de soporte o comprobante de pago), nunca se puede borrar — protege
// evidencia real. Si nunca tuvo ningún archivo, sí se puede borrar.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageAdminPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const request = await prisma.adminPaymentRequest.findUnique({ where: { id } });
  if (!request) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (request.declarationFileUrl || request.paymentProofUrl) {
    return NextResponse.json({ error: "No se puede borrar: ya tiene un archivo cargado." }, { status: 409 });
  }

  await prisma.adminPaymentRequest.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
