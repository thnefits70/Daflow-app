import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseReentry } from "@/lib/guards";

const FIXED_DAMAGE_REASONS = ["Producto roto", "Empaque abierto", "Humedad/manchado", "Golpeado"];

const schema = z
  .object({
    catalogItemId: z.string().min(1),
    damagedQty: z.number().int().nonnegative(),
    damageReasonName: z.string().trim().optional(),
    damageReasonOther: z.string().trim().max(200).optional(),
  })
  .refine((d) => d.damagedQty === 0 || !!d.damageReasonName || !!d.damageReasonOther, { message: "Falta el motivo del daño." });

// Pedido del usuario 2026-10-02: en un lote escaneado, Joel solo marca lo
// dañado — por producto, sobre lo que trajeron las guías del lote. Lo que
// no marca se toma como bueno. Una fila de "dañadas" por producto
// (scanDamage); se descuenta de las buenas recién al enviar el lote.
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
  if (d.damagedQty > total) return NextResponse.json({ error: `Solo llegaron ${total} unidad(es) de este producto en las guías escaneadas.` }, { status: 409 });

  const existing = await prisma.merchandiseReentryItem.findFirst({ where: { batchId: id, scanDamage: true, catalogItemId: d.catalogItemId }, select: { id: true } });
  if (d.damagedQty === 0) {
    if (existing) await prisma.merchandiseReentryItem.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true });
  }

  let damageReasonId: string | null = null;
  if (d.damageReasonName && FIXED_DAMAGE_REASONS.includes(d.damageReasonName)) {
    damageReasonId = (await prisma.merchandiseDamageReason.upsert({ where: { name: d.damageReasonName }, update: {}, create: { name: d.damageReasonName } })).id;
  }
  const data = {
    damagedQty: d.damagedQty,
    damageReasonId,
    damageReasonOther: damageReasonId ? null : d.damageReasonOther || d.damageReasonName || null,
  };
  if (existing) await prisma.merchandiseReentryItem.update({ where: { id: existing.id }, data });
  else await prisma.merchandiseReentryItem.create({ data: { batchId: id, photoUrls: [], catalogItemId: d.catalogItemId, aiRecognized: true, goodQty: 0, scanDamage: true, ...data } });
  return NextResponse.json({ ok: true });
}
