import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

// Confirmado 2026-08-06: eliminar una cuenta ya registrada es solo del
// admin — las solicitudes que ya la usaron conservan su historial
// (bankAccountId queda en null, no se borra la solicitud).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; accountId: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id, accountId } = await params;
  const account = await prisma.adminPaymentPayeeBankAccount.findUnique({ where: { id: accountId } });
  if (!account || account.payeeId !== id) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  await prisma.adminPaymentPayeeBankAccount.delete({ where: { id: accountId } });
  return NextResponse.json({ ok: true });
}
