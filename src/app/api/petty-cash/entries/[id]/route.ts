import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManagePettyCashPrincipal, canManagePettyCashSecundaria } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  action: z.enum(["edit", "archive", "restore"]),
  amount: z.number().positive().optional(),
  description: z.string().trim().min(1).optional(),
});

// Confirmado 2026-08-05: ningún movimiento se elimina — solo se edita
// (corrige monto/descripción) o se archiva/restaura. El saldo se recalcula
// solo, ya que siempre se calcula a partir de las filas no archivadas.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const entry = await prisma.pettyCashEntry.findUnique({ where: { id }, include: { box: true } });
  if (!entry) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const authorized = entry.box.type === "PRINCIPAL" ? await canManagePettyCashPrincipal() : await canManagePettyCashSecundaria();
  if (!authorized) return NextResponse.json({ error: "No autorizado para esta caja." }, { status: 403 });

  const isAdmin = session.user.role === "admin";
  const actorId = isAdmin ? null : session.user.id;

  // Confirmado 2026-08-06: solo admin edita cuánto se fondeó una caja — quien
  // recibe el fondeo (Nairoby/Bryan) no puede cambiar ese monto, ya que es el
  // admin quien de verdad recarga cada caja. Editar un DESEMBOLSO (su propio
  // registro de pago) sigue permitido para el manager de la caja.
  if (parsed.data.action === "edit" && entry.kind === "RECARGA" && !isAdmin) {
    return NextResponse.json({ error: "Solo el admin puede editar el monto de un fondeo." }, { status: 403 });
  }

  if (parsed.data.action === "edit") {
    const data: { amount?: number; description?: string; updatedById: string | null } = { updatedById: actorId };
    if (parsed.data.amount !== undefined) data.amount = parsed.data.amount;
    if (parsed.data.description !== undefined) data.description = parsed.data.description;
    const updated = await prisma.pettyCashEntry.update({ where: { id }, data });
    return NextResponse.json({ ok: true, entry: updated });
  }

  if (parsed.data.action === "archive") {
    const updated = await prisma.pettyCashEntry.update({
      where: { id },
      data: { archived: true, archivedAt: new Date(), archivedById: actorId },
    });
    return NextResponse.json({ ok: true, entry: updated });
  }

  const updated = await prisma.pettyCashEntry.update({
    where: { id },
    data: { archived: false, restoredAt: new Date(), restoredById: actorId },
  });
  return NextResponse.json({ ok: true, entry: updated });
}
