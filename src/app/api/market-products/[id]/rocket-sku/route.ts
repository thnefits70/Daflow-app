import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canUploadRocketSku } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

// Rocket muestra dos datos por producto: el ID (números, ej. 5417 — es lo
// que traen las guías: "(5417) Nombre x 1") y el SKU (texto, ej.
// "2075-PRO-TENSIOMETRO-DIGITAL", solo referencia — opcional desde
// 2026-10-10, pedido del usuario: las guías no lo traen). El ID se acepta
// también con la "R" delante, como sale en los cortes.
const schema = z.object({
  rocketProductId: z
    .string()
    .trim()
    .transform((v) => v.replace(/^r/i, ""))
    .refine((v) => /^\d{2,}$/.test(v), "El ID de Rocket son solo números (el que sale junto al SKU en Rocket)."),
  rocketSku: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => v || null),
});

// Aprobado por Bryan 2026-10-10: Yair sube a Rocket (cuenta Provedix) lo que
// Bryan aprobó como "Solo Rocket por ahora" y escribe su ID y SKU de Rocket.
// El ID se guarda como RocketCodeMapping (un alias más, igual que los demás
// productos de Rocket) para que los cortes lo reconozcan solos — NUNCA toca
// el ID madre del Kardex (justCode). Se puede corregir si se equivocó.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canUploadRocketSku()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { rocketProductId, rocketSku } = parsed.data;

  const existing = await prisma.marketProductProposal.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.status !== "APPROVED" || !existing.rocketOnly) return NextResponse.json({ error: "Este producto no está aprobado para Rocket." }, { status: 409 });
  if (!existing.catalogItemId) return NextResponse.json({ error: "Este producto no tiene catálogo — avisa al admin." }, { status: 409 });
  const catalogItemId = existing.catalogItemId;

  const taken = await prisma.rocketCodeMapping.findUnique({
    where: { rocketCode: rocketProductId },
    include: { catalogItem: { select: { name: true } }, dropiCombo: { select: { label: true } } },
  });
  if (taken && taken.catalogItemId !== catalogItemId) {
    const other = taken.catalogItem?.name ?? taken.dropiCombo?.label ?? taken.rocketName;
    return NextResponse.json({ error: `El ID de Rocket ${rocketProductId} ya está unido a "${other}". Revisa que sea el ID correcto.` }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    // Corrección: el ID anterior de este mismo producto deja de apuntarle.
    if (existing.rocketProductId && existing.rocketProductId !== rocketProductId) {
      await tx.rocketCodeMapping.deleteMany({ where: { rocketCode: existing.rocketProductId, catalogItemId } });
    }
    await tx.rocketCodeMapping.upsert({
      where: { rocketCode: rocketProductId },
      create: { rocketCode: rocketProductId, rocketName: existing.productName, catalogItemId, createdById: session.user.id },
      update: {},
    });
    await tx.marketProductProposal.update({
      where: { id },
      data: { rocketProductId, rocketSku, rocketSkuAt: new Date(), rocketSkuById: session.user.id },
    });
  });

  if (!existing.rocketProductId) {
    const marketingLead = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "MKT" } }, select: { id: true } });
    if (marketingLead) {
      await notifyOwner(marketingLead.id, {
        title: "Ya está en Rocket",
        body: `${existing.productName} — ID ${rocketProductId}${rocketSku ? `, SKU ${rocketSku}` : ""}`,
        url: "/area/workspace?tab=analisis-mercado&ptab=trazabilidad",
      }).catch(() => null);
    }
  }

  return NextResponse.json({ ok: true, rocketProductId, rocketSku });
}
