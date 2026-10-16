import { prisma } from "@/lib/prisma";
import { ecuadorDay } from "@/lib/fulfillmentGuides";
import { heldGuideDay, recomputeAutoFillRate } from "@/lib/autoFillRate";
import { nextWorkingDay } from "@/lib/ecuadorHolidays";

// Guías retenidas por falta de stock (aprobado por el usuario 2026-10-16).
// DAFLOW sugiere cuáles en "Guías a retener" del corte; Daniel o Allan
// confirman con "Retuve esta guía". Modo automático (Daniel 2026-10-16):
// cuenta como salida el día de trabajo siguiente; "Ya salió" solo corrige el
// día si salió otro día (guideHoldDays en autoFillRate.ts).

export type HeldGuide = { guideNumber: string; catalogItemId: string; retainedAt: string; retainedByName: string | null; releasedAt: string | null; outDay: string };

type Result = { ok: true } | { ok: false; error: string };

const key = (g: string) => g.trim().toUpperCase();

export async function heldGuidesOfLot(lotId: string): Promise<HeldGuide[]> {
  const rows = await prisma.fulfillmentGuideHold.findMany({ where: { lotId }, orderBy: { retainedAt: "asc" } });
  const ids = [...new Set(rows.map((r) => r.retainedById).filter((x): x is string => !!x))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ guideNumber: r.guideNumber, catalogItemId: r.catalogItemId, retainedAt: r.retainedAt.toISOString(), retainedByName: r.retainedById ? (nameOf.get(r.retainedById) ?? null) : null, releasedAt: r.releasedAt?.toISOString() ?? null, outDay: heldGuideDay(r) }));
}

async function recompute(days: (string | null | undefined)[]): Promise<void> {
  for (const d of new Set(days.filter((x): x is string => !!x))) await recomputeAutoFillRate(d).catch(() => null);
}

export async function retainGuide(params: { lotId: string; catalogItemId: string; guideNumber: string; userId: string | null }): Promise<Result> {
  const guide = await prisma.fulfillmentRequestGuide.findFirst({
    where: { guideNumber: { equals: params.guideNumber.trim(), mode: "insensitive" }, batch: { lotId: params.lotId } },
    select: { guideNumber: true, carrier: true, batch: { select: { lot: { select: { day: true, status: true } } } } },
  });
  if (!guide) return { ok: false, error: "Esa guía no está en este corte." };
  if (guide.batch.lot?.status === "DRAFT") return { ok: false, error: "El corte todavía está en preparación." };
  try {
    await prisma.fulfillmentGuideHold.create({ data: { guideNumber: key(guide.guideNumber), lotId: params.lotId, catalogItemId: params.catalogItemId, carrier: guide.carrier, retainedById: params.userId } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { ok: false, error: "Esta guía ya está marcada como retenida." };
    throw e;
  }
  const today = ecuadorDay(new Date());
  await recompute([guide.batch.lot?.day, nextWorkingDay(today)]);
  return { ok: true };
}

// "Ya salió": cuenta como despachada hoy.
export async function releaseGuide(guideNumber: string, userId: string | null): Promise<Result> {
  const now = new Date();
  const r = await prisma.fulfillmentGuideHold.updateMany({ where: { guideNumber: key(guideNumber), releasedAt: null }, data: { releasedAt: now, releasedById: userId } });
  if (r.count === 0) return { ok: false, error: "Esta guía no está retenida (o ya salió)." };
  const hold = await prisma.fulfillmentGuideHold.findUnique({ where: { guideNumber: key(guideNumber) }, select: { lotId: true, retainedAt: true } });
  const lot = hold ? await prisma.fulfillmentLot.findUnique({ where: { id: hold.lotId }, select: { day: true } }) : null;
  await recompute([lot?.day, ecuadorDay(now), hold ? heldGuideDay({ retainedAt: hold.retainedAt, releasedAt: null }) : null]);
  return { ok: true };
}

// Marcada por error: se quita mientras no haya salido.
export async function undoRetain(guideNumber: string): Promise<Result> {
  const hold = await prisma.fulfillmentGuideHold.findUnique({ where: { guideNumber: key(guideNumber) }, select: { id: true, lotId: true, retainedAt: true, releasedAt: true } });
  if (!hold) return { ok: false, error: "Esta guía no está retenida." };
  if (hold.releasedAt) return { ok: false, error: "Esta guía ya salió: no se puede deshacer." };
  await prisma.fulfillmentGuideHold.delete({ where: { id: hold.id } });
  const lot = await prisma.fulfillmentLot.findUnique({ where: { id: hold.lotId }, select: { day: true } });
  await recompute([lot?.day, heldGuideDay(hold)]);
  return { ok: true };
}
