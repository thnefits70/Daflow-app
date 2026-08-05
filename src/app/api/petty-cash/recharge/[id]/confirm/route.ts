import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { canManagePettyCashPrincipal, canManagePettyCashSecundaria } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

// Confirmado 2026-08-05: recién acá se acredita el dinero al saldo — quien
// recibió la caja (Nairoby o Bryan) confirma que de verdad le llegó el
// monto declarado. Antes de esto, la caja queda bloqueada para desembolsos.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const entry = await prisma.pettyCashEntry.findUnique({ where: { id }, include: { box: true } });
  if (!entry || entry.kind !== "RECARGA") return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (entry.confirmedAt) return NextResponse.json({ ok: true, entry });

  const authorized = entry.box.type === "PRINCIPAL" ? await canManagePettyCashPrincipal() : await canManagePettyCashSecundaria();
  if (!authorized) return NextResponse.json({ error: "No autorizado para confirmar esta recarga." }, { status: 403 });

  const isAdmin = session.user.role === "admin";
  const updated = await prisma.pettyCashEntry.update({
    where: { id },
    data: { confirmedAt: new Date(), confirmedById: isAdmin ? null : session.user.id },
  });

  return NextResponse.json({ ok: true, entry: updated });
}
