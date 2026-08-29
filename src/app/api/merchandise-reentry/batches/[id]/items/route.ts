import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseReentry } from "@/lib/guards";

// Confirmado 2026-08-19: lista fija mostrada como chips en la captura (no un
// catálogo editable como WarrantyCategory/StockoutProduct) — el boceto
// aprobado la mostró como opciones fijas. "Otro" siempre es texto libre
// (damageReasonOther), nunca crea una fila nueva en el catálogo.
const FIXED_DAMAGE_REASONS = ["Producto roto", "Empaque abierto", "Humedad/manchado", "Golpeado"];

const schema = z
  .object({
    photoUrls: z.array(z.string().url()).min(1),
    catalogItemId: z.string().optional(),
    aiRecognized: z.boolean().default(false),
    declaredName: z.string().trim().max(200).optional(),
    goodQty: z.number().int().nonnegative(),
    damagedQty: z.number().int().nonnegative(),
    damageReasonName: z.string().trim().optional(),
    damageReasonOther: z.string().trim().max(200).optional(),
  })
  .refine((d) => !!d.catalogItemId || !!d.declaredName, { message: "Falta el nombre del producto." })
  .refine((d) => d.goodQty + d.damagedQty > 0, { message: "Las cantidades no pueden ser todas cero." })
  .refine((d) => d.damagedQty === 0 || !!d.damageReasonName || !!d.damageReasonOther, {
    message: "Falta el motivo del daño.",
  });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canCaptureMerchandiseReentry()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const d = parsed.data;

  const batch = await prisma.merchandiseReentryBatch.findUnique({ where: { id }, select: { createdById: true, submittedAt: true } });
  if (!batch) return NextResponse.json({ error: "Lote no encontrado." }, { status: 404 });
  if (batch.createdById !== session.user.id) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (batch.submittedAt) return NextResponse.json({ error: "Este lote ya fue enviado — no se puede editar." }, { status: 409 });

  let damageReasonId: string | null = null;
  if (d.damagedQty > 0 && d.damageReasonName && FIXED_DAMAGE_REASONS.includes(d.damageReasonName)) {
    const reason = await prisma.merchandiseDamageReason.upsert({
      where: { name: d.damageReasonName },
      update: {},
      create: { name: d.damageReasonName },
    });
    damageReasonId = reason.id;
  }

  const item = await prisma.merchandiseReentryItem.create({
    data: {
      batchId: id,
      photoUrls: d.photoUrls,
      catalogItemId: d.catalogItemId ?? null,
      aiRecognized: !!d.catalogItemId && d.aiRecognized,
      declaredName: d.catalogItemId ? null : d.declaredName ?? null,
      goodQty: d.goodQty,
      damagedQty: d.damagedQty,
      damageReasonId,
      damageReasonOther: d.damagedQty > 0 && !damageReasonId ? d.damageReasonOther ?? d.damageReasonName ?? null : null,
    },
    include: { catalogItem: { select: { name: true, photos: true, justCode: true } }, damageReason: { select: { name: true } } },
  });
  return NextResponse.json(item);
}
