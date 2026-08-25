import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseOutflow, canViewMerchandiseOutflow, getInventoryLeadId } from "@/lib/guards";
import { nextMerchandiseOutflowNumber, formatMerchandiseOutflowCode } from "@/lib/merchandiseOutflow";
import { notifyOwner } from "@/lib/notifications";

const schema = z.object({
  photoUrl: z.string().min(1),
  catalogItemId: z.string().min(1).optional(),
  declaredName: z.string().trim().min(1).optional(),
  quantity: z.number().int().positive(),
  damageReasonName: z.string().trim().min(1).optional(),
  damageReasonOther: z.string().trim().optional(),
});

const ITEM_INCLUDE = {
  batch: { select: { code: true, createdAt: true, createdBy: { select: { name: true } } } },
  catalogItem: { select: { name: true, photos: true } },
  damageReason: { select: { name: true } },
} as const;

// Cola de deterioro pendiente de resolución de Daniel (resolution null) —
// visible a todo el equipo de Inventario para seguimiento, aunque solo
// Daniel puede resolver (ver items/[id]/resolve).
export async function GET() {
  if (!(await canViewMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const items = await prisma.merchandiseOutflowItem.findMany({
    where: { batch: { reason: "DETERIORO" }, resolution: null },
    include: ITEM_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(items);
}

// Reporte de deterioro encontrado en bodega (NO una devolución — eso vive en
// Reingreso) — un solo paso, cualquiera del equipo de Inventario, sin
// borrador previo: foto + producto + cantidad + motivo, listo de inmediato
// en la cola de Daniel.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canCaptureMerchandiseOutflow()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  if (!parsed.data.catalogItemId && !parsed.data.declaredName) return NextResponse.json({ error: "Falta el producto." }, { status: 400 });

  let declaredName = parsed.data.declaredName ?? "";
  if (parsed.data.catalogItemId) {
    const catalogItem = await prisma.purchaseCatalogItem.findUnique({ where: { id: parsed.data.catalogItemId }, select: { name: true } });
    if (!catalogItem) return NextResponse.json({ error: "Producto no encontrado en el catálogo." }, { status: 404 });
    declaredName = catalogItem.name;
  }

  let damageReasonId: string | null = null;
  if (parsed.data.damageReasonName && parsed.data.damageReasonName !== "Otro") {
    const reason = await prisma.merchandiseDamageReason.upsert({
      where: { name: parsed.data.damageReasonName },
      update: {},
      create: { name: parsed.data.damageReasonName },
    });
    damageReasonId = reason.id;
  }

  const batchNumber = await nextMerchandiseOutflowNumber();
  const batch = await prisma.merchandiseOutflowBatch.create({
    data: {
      code: formatMerchandiseOutflowCode(batchNumber),
      batchNumber,
      reason: "DETERIORO",
      createdById: session.user.id,
      submittedAt: new Date(),
      items: {
        create: [
          {
            catalogItemId: parsed.data.catalogItemId ?? null,
            declaredName,
            quantity: parsed.data.quantity,
            photoUrls: [parsed.data.photoUrl],
            damageReasonId,
            damageReasonOther: damageReasonId ? null : parsed.data.damageReasonOther?.trim() || null,
          },
        ],
      },
    },
    include: { items: { include: ITEM_INCLUDE } },
  });

  const leadId = await getInventoryLeadId();
  if (leadId) {
    await notifyOwner(leadId, {
      title: "Deterioro reportado",
      body: `${declaredName} — ${parsed.data.quantity} un. reportadas por ${session.user.name ?? "un colaborador"}.`,
      url: "/area/workspace?tab=egresos&otab=deterioro",
    }).catch(() => null);
  }

  return NextResponse.json(batch);
}
