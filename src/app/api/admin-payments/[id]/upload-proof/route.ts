import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { readPaymentProof } from "@/lib/purchaseAi";
import { pushOwnerId } from "@/lib/pushOwner";
import { sendPushToOwner } from "@/lib/webPush";

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

  const request = await prisma.adminPaymentRequest.findUnique({ where: { id } });
  if (!request) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (request.status !== "PENDING_PAYMENT") return NextResponse.json({ error: "Ya fue pagada." }, { status: 409 });

  let readAmount: number | null = null;
  try {
    const read = await readPaymentProof({ proofImageUrl: parsed.data.proofUrl, actorId: pushOwnerId(session) });
    readAmount = read.readAmount;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo leer el comprobante." }, { status: 500 });
  }

  const matches = readAmount !== null && Math.abs(readAmount - request.monto) < 0.01;
  const note = matches
    ? `Coincide — $${readAmount?.toFixed(2)}`
    : `No coincide — el comprobante dice $${readAmount?.toFixed(2) ?? "?"}, debía ser $${request.monto.toFixed(2)}`;

  const updated = await prisma.adminPaymentRequest.update({
    where: { id },
    data: {
      paymentProofUrl: parsed.data.proofUrl,
      paymentProofName: parsed.data.proofName ?? null,
      paymentAiMatch: matches,
      paymentAiNote: note,
      ...(matches ? { status: "PAID", paidAt: new Date(), paidById: null } : {}),
    },
  });

  if (matches && request.createdById) {
    await sendPushToOwner(request.createdById, {
      title: "✅ Ya se pagó tu solicitud",
      body: `${request.motivo} — $${request.monto.toFixed(2)} · revisa el comprobante`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  return NextResponse.json({ ...updated, matches, note });
}
