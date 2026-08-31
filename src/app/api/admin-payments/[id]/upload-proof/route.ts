import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { readPaymentProof } from "@/lib/purchaseAi";
import { markGroupFreightPaid } from "@/lib/pettyCash";
import { pushOwnerId } from "@/lib/pushOwner";
import { notifyOwner } from "@/lib/notifications";

const schema = z.object({ proofUrl: z.string().url(), proofName: z.string().optional() });

// Solo admin — es quien de verdad paga. La IA lee el comprobante y lo
// compara contra el monto solicitado; si no coincide, no avanza a PAID y la
// UI debe pedir resubir (mismo espíritu bloqueante que el refund-proof de
// Control de Compras).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const request = await prisma.adminPaymentRequest.findUnique({ where: { id }, include: { proofs: true } });
  if (!request) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (request.status !== "PENDING_PAYMENT") return NextResponse.json({ error: "Ya fue pagada." }, { status: 409 });

  let readAmount: number | null = null;
  let receiptNumber: string | null = null;
  try {
    const read = await readPaymentProof({ proofImageUrl: parsed.data.proofUrl, actorId: pushOwnerId(session) });
    readAmount = read.readAmount;
    receiptNumber = read.receiptNumber;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo leer el comprobante." }, { status: 500 });
  }

  await prisma.adminPaymentProof.create({
    data: {
      requestId: id,
      fileUrl: parsed.data.proofUrl,
      fileName: parsed.data.proofName ?? null,
      readAmount,
      receiptNumber,
    },
  });

  // Confirmado 2026-08-31: pedido explícito del usuario — una solicitud puede
  // pagarse con varios comprobantes (ej. $5 a un número + $4 a una cuenta), así
  // que se cierra sola cuando la SUMA de todos los comprobantes leídos llega o
  // supera `monto` (nunca si suma de menos: ahí sigue pendiente).
  const sum = [...request.proofs, { readAmount }].reduce((acc, p) => acc + (p.readAmount ?? 0), 0);
  const matches = sum >= request.monto - 0.01;
  const count = request.proofs.length + 1;
  const note = matches
    ? `Suma de ${count} comprobante${count === 1 ? "" : "s"}: $${sum.toFixed(2)}`
    : `Llevas $${sum.toFixed(2)} de $${request.monto.toFixed(2)} — falta $${(request.monto - sum).toFixed(2)}`;

  const updated = await prisma.adminPaymentRequest.update({
    where: { id },
    data: {
      paymentProofUrl: parsed.data.proofUrl,
      paymentProofName: parsed.data.proofName ?? null,
      paymentAiMatch: matches,
      paymentAiNote: note,
      paymentAiReadAmount: sum,
      ...(matches ? { status: "PAID", paidAt: new Date(), paidById: null } : {}),
    },
    include: { proofs: { orderBy: { createdAt: "asc" } } },
  });

  if (matches && request.linkedGroupId) {
    await markGroupFreightPaid(request.linkedGroupId, null, parsed.data.proofUrl, request.monto);
  }

  if (matches && request.createdById) {
    await notifyOwner(request.createdById, {
      title: "✅ Ya se pagó tu solicitud",
      body: `${request.motivo} — $${request.monto.toFixed(2)} · revisa el comprobante`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  return NextResponse.json({ ...updated, matches, note });
}
