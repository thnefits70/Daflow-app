import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canDeclareExternalSales } from "@/lib/guards";
import { notifyAdminPaymentProofUploaded, expectedTransferAmount, PAYMENT_PROOF_AMOUNT_TOLERANCE } from "@/lib/externalSales";
import { readExternalSalePaymentProof } from "@/lib/externalSalesAi";

const schema = z.object({ proofUrl: z.string().url(), proofName: z.string().trim().optional() });

// El asesor sube el comprobante — puede pasar en cualquier momento después
// de la aprobación de Bryan (antes o después del despacho, según sea
// prepago o contra-entrega como Marcos).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canDeclareExternalSales()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: { advisorId: true, reviewStatus: true, code: true, totalAmount: true, isContraEntrega: true, freightCost: true },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.advisorId !== session.user.id && session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (sale.reviewStatus !== "APPROVED") return NextResponse.json({ error: "Esta venta todavía no está aprobada." }, { status: 409 });

  // Confirmado 2026-09-18, pedido explícito del usuario: apenas sube el
  // comprobante, la IA lo lee y lo compara contra lo esperado — así el
  // admin ya ve el resultado cuando le toca confirmar, en vez de tener que
  // comparar a ojo. Si la IA falla (foto rara, timeout, etc.) se guarda el
  // comprobante igual, solo sin verificación — nunca le bloquea a Marcos
  // subir su comprobante.
  let aiReadAmount: number | null = null;
  let aiMatches: boolean | null = null;
  try {
    const expected = expectedTransferAmount(sale);
    const read = await readExternalSalePaymentProof({ proofUrl: parsed.data.proofUrl, actorId: session.user.id, deptId: session.user.deptId ?? undefined });
    aiReadAmount = read.readAmount;
    aiMatches = read.readAmount !== null && Math.abs(read.readAmount - expected) <= PAYMENT_PROOF_AMOUNT_TOLERANCE;
  } catch {
    // La IA no pudo leer el comprobante — se guarda igual, solo sin verificación.
  }

  const updated = await prisma.externalSale.update({
    where: { id },
    data: {
      paymentProofUrl: parsed.data.proofUrl,
      paymentProofName: parsed.data.proofName || null,
      paymentProofUploadedAt: new Date(),
      paymentProofAiReadAmount: aiReadAmount,
      paymentProofAiMatches: aiMatches,
    },
  });

  await notifyAdminPaymentProofUploaded(sale.code);
  return NextResponse.json(updated);
}
