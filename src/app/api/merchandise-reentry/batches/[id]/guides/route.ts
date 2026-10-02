import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseReentry } from "@/lib/guards";
import { scanGuideIntoBatch } from "@/lib/reentryGuideScan";

const schema = z.object({
  raw: z.string().trim().min(1).max(200),
  // true = la etiqueta no se pudo leer y el número se escribió a mano (dos
  // veces, el cliente verifica que coincidan). Queda anotado en la guía.
  typedByHand: z.boolean().default(false),
});

// Pedido del usuario 2026-10-02: Joel escanea la guía de cada devolución y
// DAFLOW agrega solo sus productos al lote, con el costo real. Si la guía
// no sirve, responde la razón (200 con ok:false) y si corresponde habilita
// el registro a mano.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canCaptureMerchandiseReentry()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const batch = await prisma.merchandiseReentryBatch.findUnique({ where: { id }, select: { createdById: true, submittedAt: true } });
  if (!batch) return NextResponse.json({ error: "Lote no encontrado." }, { status: 404 });
  if (batch.createdById !== session.user.id) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (batch.submittedAt) return NextResponse.json({ error: "Este lote ya fue enviado — no se puede editar." }, { status: 409 });

  const result = await scanGuideIntoBatch({ batchId: id, raw: parsed.data.raw, typedByHand: parsed.data.typedByHand });
  return NextResponse.json(result);
}
