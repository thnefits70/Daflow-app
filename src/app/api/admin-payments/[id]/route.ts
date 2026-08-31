import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageAdminPayments, requireAdminSession } from "@/lib/guards";

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

const patchSchema = z.object({ motivo: z.string().trim().min(1) });

// Confirmado 2026-08-31: pedido explícito del usuario — corregir el título
// (motivo) de una solicitud, ej. un error de tipeo o un dato mal escrito, es
// EXCLUSIVO del admin, ni siquiera Nairoby (a diferencia del resto del
// módulo, que usa canManageAdminPayments). No toca monto ni archivos, así
// que se permite sin importar el estado de la solicitud.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const request = await prisma.adminPaymentRequest.findUnique({ where: { id } });
  if (!request) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  const updated = await prisma.adminPaymentRequest.update({
    where: { id },
    data: { motivo: parsed.data.motivo },
  });
  return NextResponse.json(updated);
}
