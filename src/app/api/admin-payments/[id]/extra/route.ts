import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  fileUrl: z.string().url().nullable().optional(),
  fileName: z.string().nullable().optional(),
  note: z.string().trim().nullable().optional(),
});

// Confirmado 2026-08-12: pedido explícito del usuario — al hacer el pago,
// admin puede opcionalmente adjuntar un segundo documento/imagen de soporte
// y una descripción breve. Solo contexto adicional — nunca pasa por IA, no
// bloquea nada, y solo aplica una vez que ya existe el comprobante principal.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const request = await prisma.adminPaymentRequest.findUnique({ where: { id } });
  if (!request) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (!request.paymentProofUrl) {
    return NextResponse.json({ error: "Primero sube el comprobante de pago principal." }, { status: 409 });
  }

  const updated = await prisma.adminPaymentRequest.update({
    where: { id },
    data: {
      paymentExtraFileUrl: parsed.data.fileUrl ?? null,
      paymentExtraFileName: parsed.data.fileName ?? null,
      paymentNote: parsed.data.note || null,
    },
  });

  return NextResponse.json(updated);
}
