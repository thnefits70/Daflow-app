import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseOutflow, dbUserId, getInventoryLeadId } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { autoApproveReadyReentryItems, formatMerchandiseReentryCode, nextMerchandiseReentryNumber } from "@/lib/merchandiseReentry";

// Mismos motivos fijos que Reingreso de Mercadería.
const FIXED_DAMAGE_REASONS = ["Producto roto", "Empaque abierto", "Humedad/manchado", "Golpeado"];

const schema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        // Solo para lo dañado que se cambió por garantía: cómo llegó.
        condition: z.enum(["GOOD", "DAMAGED"]).optional(),
        damageReason: z.string().trim().max(200).optional(),
        photoUrls: z.array(z.string().url()).max(6).default([]),
      })
    )
    .min(1),
});

// Pedido del usuario 2026-10-02: lo que el motorizado recoge en una
// garantía local vuelve a bodega y alguien de Inventario confirma que llegó.
// - Lo dañado que se cambió (mal funcionamiento / roto): ya se descontó en el
//   despacho original, así que entra como una devolución al REINGRESO DE
//   MERCADERÍA (lote RM propio, foto incluida): si llegó bien vuelve solo al
//   stock; si llegó dañado sigue el flujo de siempre (Daniel decide: se
//   repara, se reclama al proveedor o se da de baja).
// - Lo que se mandó por error o de más: nunca se descontó, vuelve a la
//   percha sin mover el stock.
// Recién con esto el asesor puede cerrar la garantía y se habilita el flete.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canCaptureMerchandiseOutflow()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { id } = await params;
  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: {
      kind: true,
      code: true,
      advisorId: true,
      deliveredAt: true,
      deletedAt: true,
      items: { where: { warrantyRole: "PICKUP", pickupReceivedAt: null }, select: { id: true, catalogItemId: true, declaredProductName: true, quantity: true, warrantyReason: true } },
    },
  });
  if (!sale || sale.kind !== "WARRANTY") return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.deletedAt) return NextResponse.json({ error: "Esta garantía fue cancelada." }, { status: 409 });
  if (!sale.deliveredAt) return NextResponse.json({ error: "El motorizado todavía no sale con esta garantía." }, { status: 409 });
  if (sale.items.length === 0) return NextResponse.json({ error: "Ya se confirmó todo lo que había que recoger." }, { status: 409 });

  const byId = new Map(parsed.data.items.map((i) => [i.itemId, i]));
  const defective = sale.items.filter((i) => i.warrantyReason === "MAL_FUNCIONAMIENTO" || i.warrantyReason === "PRODUCTO_ROTO");
  for (const it of sale.items) {
    if (!byId.has(it.id)) return NextResponse.json({ error: "Confirma todos los productos que trajo el motorizado." }, { status: 400 });
  }
  for (const it of defective) {
    const d = byId.get(it.id)!;
    if (!d.condition) return NextResponse.json({ error: `${it.declaredProductName}: indica si llegó en buen estado o dañado.` }, { status: 400 });
    if (d.photoUrls.length === 0) return NextResponse.json({ error: `${it.declaredProductName}: toma la foto de cómo llegó.` }, { status: 400 });
    if (d.condition === "DAMAGED" && !d.damageReason) return NextResponse.json({ error: `${it.declaredProductName}: elige qué daño tiene.` }, { status: 400 });
  }

  const receiverId = dbUserId(session.user.id);
  let reentryCode: string | null = null;
  if (defective.length > 0) {
    const batchNumber = await nextMerchandiseReentryNumber();
    reentryCode = formatMerchandiseReentryCode(batchNumber);
    const reasonIds = new Map<string, string>();
    for (const name of new Set(defective.map((it) => byId.get(it.id)!).filter((d) => d.condition === "DAMAGED" && FIXED_DAMAGE_REASONS.includes(d.damageReason!)).map((d) => d.damageReason!))) {
      const r = await prisma.merchandiseDamageReason.upsert({ where: { name }, update: {}, create: { name } });
      reasonIds.set(name, r.id);
    }
    const batch = await prisma.merchandiseReentryBatch.create({
      data: {
        code: reentryCode,
        batchNumber,
        // El lote queda a nombre de quien recibió (si fue el admin, del asesor).
        createdById: receiverId ?? sale.advisorId,
        submittedAt: new Date(),
        items: {
          create: defective.map((it) => {
            const d = byId.get(it.id)!;
            const damaged = d.condition === "DAMAGED";
            return {
              photoUrls: d.photoUrls,
              catalogItemId: it.catalogItemId,
              aiRecognized: true,
              declaredName: it.declaredProductName,
              goodQty: damaged ? 0 : it.quantity,
              damagedQty: damaged ? it.quantity : 0,
              damageReasonId: damaged ? (reasonIds.get(d.damageReason!) ?? null) : null,
              damageReasonOther: damaged && !reasonIds.has(d.damageReason!) ? `${d.damageReason} (garantía ${sale.code})` : null,
            };
          }),
        },
      },
      select: { id: true },
    });
    await autoApproveReadyReentryItems(batch.id).catch((err) => console.error("[warranty pickup] aprobación automática:", err));
    const pending = await prisma.merchandiseReentryItem.count({ where: { batchId: batch.id, approvedAt: null } });
    const leadId = pending > 0 ? await getInventoryLeadId() : null;
    if (leadId) {
      await notifyOwner(leadId, {
        title: "Reingreso de mercadería pendiente de tu revisión",
        body: `${reentryCode} — producto dañado que volvió de la garantía ${sale.code}: decide si se repara, se reclama al proveedor o se da de baja.`,
        url: "/area/reingreso-mercaderia?tab=revision",
      }).catch(() => null);
    }
  }

  await prisma.externalSaleItem.updateMany({
    where: { id: { in: sale.items.map((i) => i.id) }, pickupReceivedAt: null },
    data: { pickupReceivedAt: new Date(), pickupReceivedById: receiverId },
  });
  await notifyOwner(sale.advisorId, {
    title: "📦 Bodega recibió lo que trajo el motorizado",
    body: `${sale.code} — ya puedes confirmar el resultado de la garantía para que se pague el flete.`,
    url: "/area/workspace?tab=ventas-externas&etab=garantias",
  }).catch(() => null);
  return NextResponse.json({ ok: true, reentryCode });
}
