import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

// Confirmado 2026-08-03: eliminar una cuenta bancaria ya registrada es SOLO
// del administrador (nadie más ve esta opción en la UI) — las solicitudes
// que ya pagaron a esta cuenta conservan su historial (bankAccountId queda
// en null, no se borra la solicitud).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; accountId: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id, accountId } = await params;
  const account = await prisma.supplierBankAccount.findUnique({ where: { id: accountId } });
  if (!account || account.supplierId !== id) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  await prisma.supplierBankAccount.delete({ where: { id: accountId } });
  return NextResponse.json({ ok: true });
}
