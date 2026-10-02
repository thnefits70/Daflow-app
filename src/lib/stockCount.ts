import { prisma } from "@/lib/prisma";
import { getCurrentStock } from "@/lib/stockKardex";
import { WAREHOUSE_AREAS } from "@/lib/warehouseAreas";
import { ecuadorDay } from "@/lib/fulfillmentGuides";

// Conteo físico de inventario — pedido del usuario 2026-10-02.
// - FULL: conteo general de toda la bodega (una vez). Cuando el admin lo
//   aprueba se guarda PlatformSettings.fullStockCountCompletedAt.
// - WEEKLY_AREA: desde la semana siguiente, un área distinta cada semana
//   (A, B, … G y vuelve a empezar).
// El equipo cuenta A CIEGAS (nunca ve el número del sistema), Daniel revisa
// y envía, el admin aprueba las diferencias en una sola lista.

export type CountableProduct = { id: string; name: string; justCode: string | null; photo: string | null; area: string | null };

// Lunes (YYYY-MM-DD, Ecuador) de la semana de `day`.
export function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = d.getUTCDay();
  return new Date(d.getTime() - ((dow + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}

// Área que toca contar esta semana, o null si el conteo general todavía no
// se aprobó (la rotación empieza la semana SIGUIENTE a esa aprobación).
export async function weeklyAreaFor(today = ecuadorDay(new Date())): Promise<{ area: string; weekStart: string } | null> {
  const settings = await prisma.platformSettings.findUnique({ where: { id: "singleton" }, select: { fullStockCountCompletedAt: true } });
  if (!settings?.fullStockCountCompletedAt) return null;
  const firstWeek = new Date(`${mondayOf(ecuadorDay(settings.fullStockCountCompletedAt))}T12:00:00Z`).getTime() + 7 * 86_400_000;
  const thisWeek = mondayOf(today);
  const weeks = Math.floor((new Date(`${thisWeek}T12:00:00Z`).getTime() - firstWeek) / (7 * 86_400_000));
  if (weeks < 0) return null;
  return { area: WAREHOUSE_AREAS[weeks % WAREHOUSE_AREAS.length], weekStart: thisWeek };
}

export async function fullCountCompleted(): Promise<boolean> {
  const s = await prisma.platformSettings.findUnique({ where: { id: "singleton" }, select: { fullStockCountCompletedAt: true } });
  return !!s?.fullStockCountCompletedAt;
}

// Lo que el sistema espera que haya físicamente AHORA en bodega.
async function expectedNow(catalogItemId: string): Promise<number> {
  const [stock, picked, received] = await Promise.all([
    getCurrentStock(catalogItemId),
    // Ya sacado de la percha en un corte que Daniel todavía no confirma.
    prisma.fulfillmentLotPick.aggregate({ where: { catalogItemId, confirmedAt: null, lot: { status: "SENT" } }, _sum: { pickedQty: true } }),
    // Ya llegó a bodega pero todavía no entra al stock (compra sin aprobar).
    prisma.purchaseRequestReceipt.aggregate({ where: { stockKardexEntry: null, request: { catalogItemId, status: "RECEIVED_PENDING_REVIEW" } }, _sum: { receivedQuantity: true } }),
  ]);
  return stock.balance - (picked._sum.pickedQty ?? 0) + (received._sum.receivedQuantity ?? 0);
}

async function products(area: string | null): Promise<CountableProduct[]> {
  const items = await prisma.purchaseCatalogItem.findMany({
    where: area ? { warehouseArea: area } : {},
    select: { id: true, name: true, justCode: true, photos: true, warehouseArea: true },
    orderBy: [{ warehouseArea: "asc" }, { name: "asc" }],
  });
  return items.map((i) => ({ id: i.id, name: i.name, justCode: i.justCode, photo: i.photos[0] ?? null, area: i.warehouseArea }));
}

// El conteo abierto: el general si existe uno sin aprobar; si no, el de la
// semana (se crea solo al abrirlo).
export async function getActiveCount(userId: string | null) {
  const open = await prisma.stockCount.findFirst({ where: { kind: "FULL", status: { not: "APPROVED" } }, orderBy: { startedAt: "desc" } });
  if (open) return open;
  const week = await weeklyAreaFor();
  if (!week) return null;
  return prisma.stockCount.upsert({
    where: { kind_weekStart_area: { kind: "WEEKLY_AREA", weekStart: week.weekStart, area: week.area } },
    update: {},
    create: { kind: "WEEKLY_AREA", weekStart: week.weekStart, area: week.area, startedById: userId },
  });
}

export async function startFullCount(userId: string | null) {
  const open = await prisma.stockCount.findFirst({ where: { kind: "FULL", status: { not: "APPROVED" } } });
  if (open) return open;
  return prisma.stockCount.create({ data: { kind: "FULL", startedById: userId } });
}

export type CountView = {
  id: string;
  kind: "FULL" | "WEEKLY_AREA";
  status: "COUNTING" | "SUBMITTED" | "APPROVED";
  area: string | null;
  weekStart: string | null;
  products: (CountableProduct & { countedQty: number | null; countedByName: string | null; countedAt: string | null })[];
};

// Vista para quien cuenta / Daniel: NUNCA incluye lo que dice el sistema.
export async function getCountView(countId: string): Promise<CountView | null> {
  const count = await prisma.stockCount.findUnique({ where: { id: countId }, include: { lines: true } });
  if (!count) return null;
  const list = await products(count.kind === "WEEKLY_AREA" ? count.area : null);
  const byItem = new Map(count.lines.map((l) => [l.catalogItemId, l]));
  const userIds = [...new Set(count.lines.map((l) => l.countedById).filter((x): x is string => !!x))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return {
    id: count.id,
    kind: count.kind,
    status: count.status,
    area: count.area,
    weekStart: count.weekStart,
    products: list.map((p) => {
      const l = byItem.get(p.id);
      return { ...p, countedQty: l?.countedQty ?? null, countedByName: l?.countedById ? (nameOf.get(l.countedById) ?? null) : null, countedAt: l?.countedAt.toISOString() ?? null };
    }),
  };
}

export async function recordCount(params: { countId: string; catalogItemId: string; quantity: number; userId: string | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(params.quantity) || params.quantity < 0) return { ok: false, error: "Escribe una cantidad entera, 0 o mayor." };
  const count = await prisma.stockCount.findUnique({ where: { id: params.countId }, select: { status: true, kind: true, area: true } });
  if (!count) return { ok: false, error: "Conteo no encontrado." };
  if (count.status !== "COUNTING") return { ok: false, error: "Este conteo ya se envió: no se puede cambiar." };
  if (count.kind === "WEEKLY_AREA") {
    const item = await prisma.purchaseCatalogItem.findUnique({ where: { id: params.catalogItemId }, select: { warehouseArea: true } });
    if (item?.warehouseArea !== count.area) return { ok: false, error: `Este producto no es del área ${count.area}.` };
  }
  const expectedQty = await expectedNow(params.catalogItemId);
  await prisma.stockCountLine.upsert({
    where: { countId_catalogItemId: { countId: params.countId, catalogItemId: params.catalogItemId } },
    update: { countedQty: params.quantity, countedById: params.userId, countedAt: new Date(), expectedQty },
    create: { countId: params.countId, catalogItemId: params.catalogItemId, countedQty: params.quantity, countedById: params.userId, expectedQty },
  });
  return { ok: true };
}

// Daniel envía: lo contado queda congelado y las diferencias van al admin.
export async function submitCount(countId: string, userId: string | null): Promise<{ ok: true; differences: number } | { ok: false; error: string }> {
  const count = await prisma.stockCount.findUnique({ where: { id: countId }, include: { lines: true } });
  if (!count) return { ok: false, error: "Conteo no encontrado." };
  if (count.status !== "COUNTING") return { ok: false, error: "Este conteo ya se envió." };
  if (count.lines.length === 0) return { ok: false, error: "Todavía no se contó nada." };
  const differences = count.lines.filter((l) => l.countedQty !== l.expectedQty).length;
  await prisma.stockCount.update({ where: { id: countId }, data: { status: "SUBMITTED", submittedAt: new Date(), submittedById: userId } });
  // Sin diferencias no hay nada que aprobar: queda aprobado solo.
  if (differences === 0) await finishCount(countId, null);
  return { ok: true, differences };
}

export type DifferenceRow = { lineId: string; catalogItemId: string; name: string; justCode: string | null; area: string | null; expectedQty: number; countedQty: number; diff: number; countedByName: string | null };

// Para el admin: solo las diferencias (aquí sí se muestra el sistema).
export async function getDifferences(countId: string): Promise<DifferenceRow[]> {
  const lines = await prisma.stockCountLine.findMany({ where: { countId, decision: null }, orderBy: { countedAt: "asc" } });
  const diffs = lines.filter((l) => l.countedQty !== l.expectedQty);
  const [items, users] = await Promise.all([
    prisma.purchaseCatalogItem.findMany({ where: { id: { in: diffs.map((d) => d.catalogItemId) } }, select: { id: true, name: true, justCode: true, warehouseArea: true } }),
    prisma.user.findMany({ where: { id: { in: diffs.map((d) => d.countedById).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
  ]);
  const item = new Map(items.map((i) => [i.id, i]));
  const user = new Map(users.map((u) => [u.id, u.name]));
  return diffs.map((l) => ({
    lineId: l.id,
    catalogItemId: l.catalogItemId,
    name: item.get(l.catalogItemId)?.name ?? "Producto",
    justCode: item.get(l.catalogItemId)?.justCode ?? null,
    area: item.get(l.catalogItemId)?.warehouseArea ?? null,
    expectedQty: l.expectedQty,
    countedQty: l.countedQty,
    diff: l.countedQty - l.expectedQty,
    countedByName: l.countedById ? (user.get(l.countedById) ?? null) : null,
  }));
}

async function finishCount(countId: string, adminId: string | null) {
  const count = await prisma.stockCount.update({ where: { id: countId }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: adminId } });
  if (count.kind === "FULL") {
    await prisma.platformSettings.update({ where: { id: "singleton" }, data: { fullStockCountCompletedAt: new Date() } });
  }
}

// El admin aprueba la lista: cada diferencia aprobada se aplica sobre el
// saldo ACTUAL como ajuste por conteo físico (la diferencia que había en el
// momento de contar, no el número contado, para no pisar lo que se movió
// después). Las rechazadas no tocan el stock.
export async function approveDifferences(params: { countId: string; approveLineIds: string[]; adminId: string | null }): Promise<{ ok: true; applied: number; rejected: number } | { ok: false; error: string }> {
  const count = await prisma.stockCount.findUnique({ where: { id: params.countId }, select: { status: true } });
  if (!count) return { ok: false, error: "Conteo no encontrado." };
  if (count.status !== "SUBMITTED") return { ok: false, error: "Este conteo no está esperando aprobación." };
  const pending = (await prisma.stockCountLine.findMany({ where: { countId: params.countId, decision: null } })).filter((l) => l.countedQty !== l.expectedQty);
  const approve = new Set(params.approveLineIds);
  let applied = 0;
  let rejected = 0;
  for (const l of pending) {
    if (approve.has(l.id)) {
      const claimed = await prisma.stockCountLine.updateMany({ where: { id: l.id, decision: null }, data: { decision: "APPROVED", decidedAt: new Date() } });
      if (claimed.count === 0) continue;
      const current = await getCurrentStock(l.catalogItemId);
      const delta = l.countedQty - l.expectedQty;
      await prisma.stockKardexEntry.create({
        data: {
          catalogItemId: l.catalogItemId,
          type: "PHYSICAL_COUNT_ADJUSTMENT",
          quantity: delta,
          unitCost: current.avgCost,
          balanceAfter: current.balance + delta,
          avgCostAfter: current.avgCost,
          occurredAt: new Date(),
        },
      });
      applied++;
    } else {
      await prisma.stockCountLine.updateMany({ where: { id: l.id, decision: null }, data: { decision: "REJECTED", decidedAt: new Date() } });
      rejected++;
    }
  }
  await finishCount(params.countId, params.adminId);
  return { ok: true, applied, rejected };
}

export async function getSubmittedCounts() {
  return prisma.stockCount.findMany({ where: { status: "SUBMITTED" }, orderBy: { submittedAt: "asc" }, select: { id: true, kind: true, area: true, weekStart: true, submittedAt: true } });
}
