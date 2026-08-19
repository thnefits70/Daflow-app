import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { actorName } from "@/lib/actorName";

const schema = z.object({
  amount: z.number().positive(),
  reason: z.string().trim().min(1, "Describe el motivo del crédito."),
  proofUrl: z.string().url({ message: "Falta el comprobante — captura del chat o documento donde el proveedor acepta." }),
  proofName: z.string().trim().optional(),
});

// Confirmado 2026-08-12: pedido explícito del usuario — un crédito también
// se puede registrar A MANO (sin pasar por un reporte urgente), siempre con
// comprobante obligatorio. Queda disponible de inmediato (no bloquea nada),
// pero admin recibe un aviso privado apenas se registra, para supervisar
// cómo se está usando el crédito manual con cada proveedor.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canSubmitPurchaseRequests()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id: supplierId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true } });
  if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado." }, { status: 404 });

  const isAdmin = session.user.role === "admin";
  const credit = await prisma.supplierCredit.create({
    data: {
      supplierId,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
      proofUrl: parsed.data.proofUrl,
      proofName: parsed.data.proofName || null,
      status: "AVAILABLE",
      createdById: isAdmin ? null : session.user.id,
    },
  });

  // Confirmado 2026-08-12: notificación privada, solo para admin — para
  // supervisar sin frenar el uso del crédito (que ya queda disponible).
  await notifyOwner("admin", {
    title: "🔔 Nuevo crédito manual registrado",
    body: `${supplier.name} — $${parsed.data.amount.toFixed(2)} · ${parsed.data.reason} · registrado por ${actorName(isAdmin ? null : session.user.name)}`,
    url: "/admin",
  }).catch(() => null);

  return NextResponse.json(credit, { status: 201 });
}
