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

const patchSchema = z
  .object({
    motivo: z.string().trim().min(1).optional(),
    payeeId: z.string().nullable().optional(),
    bankAccountId: z.string().nullable().optional(),
  })
  .refine((d) => d.motivo !== undefined || d.payeeId !== undefined || d.bankAccountId !== undefined, {
    message: "Nada para actualizar.",
  });

// Confirmado 2026-08-31: pedido explícito del usuario — corregir el título
// (motivo) de una solicitud, ej. un error de tipeo o un dato mal escrito, es
// EXCLUSIVO del admin, ni siquiera Nairoby (a diferencia del resto del
// módulo, que usa canManageAdminPayments). No toca monto ni archivos, así
// que se permite sin importar el estado de la solicitud.
//
// payeeId/bankAccountId (agregado el mismo día): corrige el beneficiario y/o
// cuenta bancaria de una solicitud ya enviada — ej. se envió sin elegir
// cuenta. También exclusivo del admin porque los datos bancarios lo son en
// toda la app.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const request = await prisma.adminPaymentRequest.findUnique({ where: { id } });
  if (!request) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  const data: { motivo?: string; payeeId?: string | null; bankAccountId?: string | null } = {};
  if (parsed.data.motivo !== undefined) data.motivo = parsed.data.motivo;

  if (parsed.data.payeeId !== undefined || parsed.data.bankAccountId !== undefined) {
    const nextPayeeId = parsed.data.payeeId !== undefined ? parsed.data.payeeId : request.payeeId;
    const nextBankAccountId = parsed.data.bankAccountId !== undefined ? parsed.data.bankAccountId : request.bankAccountId;
    if (nextBankAccountId) {
      if (!nextPayeeId) return NextResponse.json({ error: "Elige primero un beneficiario." }, { status: 400 });
      const account = await prisma.adminPaymentPayeeBankAccount.findUnique({ where: { id: nextBankAccountId } });
      if (!account || account.payeeId !== nextPayeeId) {
        return NextResponse.json({ error: "Esa cuenta bancaria no pertenece al beneficiario elegido." }, { status: 400 });
      }
    }
    data.payeeId = nextPayeeId;
    data.bankAccountId = nextBankAccountId;
  }

  const updated = await prisma.adminPaymentRequest.update({ where: { id }, data });
  return NextResponse.json(updated);
}
