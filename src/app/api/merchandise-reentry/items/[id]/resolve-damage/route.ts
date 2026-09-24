import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseReentry } from "@/lib/guards";
import { itemDisplayName, maybeMarkBatchApproved, notifyAdminDamageSolved, getOrCreateCurrentWeekWriteOffBatch } from "@/lib/merchandiseReentry";
import { claimReentryDamageToSupplier, ReentryClaimError } from "@/lib/reentrySupplierClaim";

const schema = z.object({
  // supplier_claim (confirmado 2026-09-24, pedido de Nairoby): dañado, pero
  // no se da de baja — se reclama al proveedor (cambio o saldo a favor).
  outcome: z.enum(["not_damaged", "solved", "unsolved", "supplier_claim"]),
  solutionNote: z.string().trim().min(1).max(2000).optional(),
  linkOutflowItemId: z.string().nullable().optional(),
});

// Daniel verifica físicamente si de verdad está dañado y, si lo está, si se
// pudo solucionar con un repuesto (pedido 2026-08-21, evita el doble
// proceso reingreso+baja). not_damaged: en realidad está bueno, esas
// unidades se suman a goodQty y siguen el camino normal hacia Just.
// solved: se reparó — mismo efecto que not_damaged sobre las cantidades,
// pero queda registrada la explicación y se notifica al admin. unsolved:
// se mantiene dañado — entra al acumulado semanal de baja (no se toca
// damagedQty, sigue esperando el corte del sábado).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnMerchandiseReentry()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  if (parsed.data.outcome === "solved" && !parsed.data.solutionNote) {
    return NextResponse.json({ error: "Explica qué se hizo para solucionarlo." }, { status: 400 });
  }

  const item = await prisma.merchandiseReentryItem.findUnique({
    where: { id },
    include: { batch: { select: { submittedAt: true } }, catalogItem: { select: { name: true } } },
  });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!item.batch.submittedAt) return NextResponse.json({ error: "Este lote todavía no fue enviado." }, { status: 409 });
  if (item.damagedQty <= 0) return NextResponse.json({ error: "Este producto no tiene unidades dañadas declaradas." }, { status: 409 });

  const actorId = session.user.id;
  const now = new Date();
  // La pregunta del daño ya queda resuelta con esta respuesta sea cual sea
  // — lo único que puede seguir faltando para aprobar el item es el nombre.
  const nameStillMissing = !item.aiRecognized && !item.correctedName;
  const approveFields = nameStillMissing ? {} : { approvedAt: item.approvedAt ?? now, approvedById: item.approvedById ?? actorId };

  let weeklyBatchId: string | null = null;
  if (parsed.data.outcome === "unsolved") {
    weeklyBatchId = (await getOrCreateCurrentWeekWriteOffBatch()).id;
  }

  const updated = await prisma.merchandiseReentryItem.update({
    where: { id },
    data: {
      damageConfirmed: parsed.data.outcome !== "not_damaged",
      damageConfirmedAt: now,
      damageConfirmedById: actorId,
      ...(parsed.data.outcome === "not_damaged" ? { goodQty: item.goodQty + item.damagedQty, damagedQty: 0 } : {}),
      ...(parsed.data.outcome === "solved"
        ? {
            damageSolved: true,
            damageSolvedAt: now,
            damageSolvedById: actorId,
            damageSolutionNote: parsed.data.solutionNote,
            goodQty: item.goodQty + item.damagedQty,
            damagedQty: 0,
          }
        : {}),
      ...(parsed.data.outcome === "unsolved"
        ? { damageSolved: false, damageSolvedAt: now, damageSolvedById: actorId, weeklyWriteOffBatchId: weeklyBatchId }
        : {}),
      ...(parsed.data.outcome === "supplier_claim" ? { damageSolved: false, damageSolvedAt: now, damageSolvedById: actorId } : {}),
      ...approveFields,
    },
  });

  if (parsed.data.outcome === "supplier_claim") {
    try {
      await claimReentryDamageToSupplier({ reentryItemId: id, actorId, actorName: session.user.name ?? "Daniel", linkOutflowItemId: parsed.data.linkOutflowItemId ?? null, note: parsed.data.solutionNote ?? null });
    } catch (e) {
      // El daño ya quedó confirmado; si el reclamo falla, cae a la lista
      // semanal para que nunca quede sin camino — Daniel puede pasarlo a
      // reclamo desde ahí con el mismo botón.
      await prisma.merchandiseReentryItem.update({ where: { id }, data: { weeklyWriteOffBatchId: (await getOrCreateCurrentWeekWriteOffBatch()).id } });
      await maybeMarkBatchApproved(item.batchId);
      const msg = e instanceof ReentryClaimError ? e.message : "No se pudo crear el reclamo.";
      return NextResponse.json({ error: `${msg} Quedó en la lista semanal de dañados; pásalo a reclamo desde Control de Daños.` }, { status: 409 });
    }
  }

  await maybeMarkBatchApproved(item.batchId);
  if (parsed.data.outcome === "solved") {
    await notifyAdminDamageSolved(itemDisplayName({ correctedName: item.correctedName, catalogItem: item.catalogItem, declaredName: item.declaredName }), parsed.data.solutionNote!);
  }
  return NextResponse.json(updated);
}
