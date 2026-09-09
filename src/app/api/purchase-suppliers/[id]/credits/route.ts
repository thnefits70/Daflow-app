import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  amount: z.number().positive(),
  reason: z.string().trim().min(1, "Describe el motivo del crédito."),
  proofUrl: z.string().url({ message: "Falta el comprobante — captura del chat o documento donde el proveedor acepta." }),
  proofName: z.string().trim().optional(),
});

// Confirmado 2026-08-12: un crédito también se puede registrar A MANO (sin
// pasar por un reporte urgente), siempre con comprobante obligatorio. Queda
// disponible de inmediato (no bloquea nada).
// Confirmado 2026-09-09: pedido explícito del usuario — restringido a SOLO
// admin (antes también podían Nairoby y Jariel vía canSubmitPurchaseRequests).
// Ya no hace falta la notificación de supervisión ni distinguir createdById,
// porque el único que lo registra ya es admin.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id: supplierId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true } });
  if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado." }, { status: 404 });

  const credit = await prisma.supplierCredit.create({
    data: {
      supplierId,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
      proofUrl: parsed.data.proofUrl,
      proofName: parsed.data.proofName || null,
      status: "AVAILABLE",
      createdById: null,
    },
  });

  return NextResponse.json(credit, { status: 201 });
}
