import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { readPaymentProof } from "@/lib/purchaseAi";
import { pushOwnerId } from "@/lib/pushOwner";
import { notifyOwner } from "@/lib/notifications";

const schema = z.object({ proofUrl: z.string().url(), proofName: z.string().optional() });

// Confirmado 2026-08-20: el colaborador pega (Ctrl+V) el comprobante de su
// transferencia — mismo mecanismo que ya usa Pagos administrativos. La IA
// lee el monto y lo compara contra el total, pero es solo informativo acá
// (a diferencia de admin-payments): el gate real es la doble confirmación
// del admin más adelante, así que SIEMPRE avanza a PENDING_ADMIN_CONFIRM,
// coincida o no — el admin ve el veredicto de la IA y decide con su propio
// banco a la vista.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const order = await prisma.personalPurchaseOrder.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (order.employeeId !== session.user.id) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (order.status !== "PENDING_TRANSFER_PROOF") return NextResponse.json({ error: "Ya fue procesado." }, { status: 409 });

  let readAmount: number | null = null;
  try {
    const read = await readPaymentProof({ proofImageUrl: parsed.data.proofUrl, actorId: pushOwnerId(session) });
    readAmount = read.readAmount;
  } catch {
    readAmount = null;
  }

  const matches = readAmount !== null && order.totalAmount !== null && Math.abs(readAmount - order.totalAmount) < 0.01;
  const note =
    readAmount === null
      ? "La IA no pudo leer el monto del comprobante."
      : matches
        ? `Coincide — $${readAmount.toFixed(2)}`
        : `No coincide — el comprobante dice $${readAmount.toFixed(2)}, debía ser $${order.totalAmount?.toFixed(2)}`;

  const updated = await prisma.personalPurchaseOrder.update({
    where: { id },
    data: {
      status: "PENDING_ADMIN_CONFIRM",
      transferProofUrl: parsed.data.proofUrl,
      transferProofName: parsed.data.proofName ?? null,
      transferProofUploadedAt: new Date(),
      transferAiReadAmount: readAmount,
      transferAiMatch: matches,
      transferAiNote: note,
    },
  });

  await notifyOwner("admin", {
    title: "🏦 Comprobante de compra personal por confirmar",
    body: `${session.user.name} — $${order.totalAmount?.toFixed(2)}${matches ? "" : " · revisar (la IA no lo confirma)"}`,
    url: "/area/nomina?tab=pagos&ptab=comprasfinanzas",
  });

  return NextResponse.json(updated);
}
