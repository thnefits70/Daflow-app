import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseReentry } from "@/lib/guards";

const schema = z.object({ catalogItemId: z.string().min(1), missingQty: z.number().int().nonnegative() });

// Pedido del usuario 2026-10-03: devolución incompleta. Joel marca, por
// producto, cuántas unidades de las guías escaneadas NO llegaron. Va en la
// misma fila por producto que las dañadas (scanDamage) y se descuenta de las
// buenas al enviar el lote (applyScanDamage) — nunca entra al stock.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canCaptureMerchandiseReentry()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const d = parsed.data;

  const batch = await prisma.merchandiseReentryBatch.findUnique({ where: { id }, select: { createdById: true, submittedAt: true } });
  if (!batch) return NextResponse.json({ error: "Lote no encontrado." }, { status: 404 });
  if (batch.createdById !== session.user.id) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (batch.submittedAt) return NextResponse.json({ error: "Este lote ya fue enviado — no se puede editar." }, { status: 409 });

  const scanned = await prisma.merchandiseReentryItem.aggregate({ where: { batchId: id, guideId: { not: null }, catalogItemId: d.catalogItemId }, _sum: { goodQty: true } });
  const total = scanned._sum.goodQty ?? 0;
  if (total === 0) return NextResponse.json({ error: "Este producto no vino en ninguna guía escaneada de este lote." }, { status: 409 });

  const existing = await prisma.merchandiseReentryItem.findFirst({ where: { batchId: id, scanDamage: true, catalogItemId: d.catalogItemId }, select: { id: true, damagedQty: true } });
  const damaged = existing?.damagedQty ?? 0;
  if (d.missingQty + damaged > total) {
    return NextResponse.json({ error: `Salieron ${total} unidad(es) de este producto en las guías${damaged ? ` y ya marcaste ${damaged} dañada(s)` : ""}: no pueden faltar ${d.missingQty}.` }, { status: 409 });
  }

  if (existing) {
    if (d.missingQty === 0 && damaged === 0) await prisma.merchandiseReentryItem.delete({ where: { id: existing.id } });
    else await prisma.merchandiseReentryItem.update({ where: { id: existing.id }, data: { missingQty: d.missingQty } });
  } else if (d.missingQty > 0) {
    await prisma.merchandiseReentryItem.create({ data: { batchId: id, photoUrls: [], catalogItemId: d.catalogItemId, aiRecognized: true, goodQty: 0, damagedQty: 0, scanDamage: true, missingQty: d.missingQty } });
  }
  return NextResponse.json({ ok: true });
}
