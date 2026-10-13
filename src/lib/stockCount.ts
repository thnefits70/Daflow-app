import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentStock } from "@/lib/stockKardex";
import { WAREHOUSE_AREAS } from "@/lib/warehouseAreas";
import { ecuadorDay } from "@/lib/fulfillmentGuides";
import { variantSuggestions } from "@/lib/variantSales";
import { applyCountToVariants } from "@/lib/variantStock";
import { notifyOwner } from "@/lib/notifications";
import { getInventoryLeadId } from "@/lib/guards";
import { isBigDifference } from "@/lib/stockCountRules";
import { COUNT_HOURS_TEXT, MAX_PRODUCT_GAP_SEC, RECOUNT, assignmentProductIds, closeShift, openAssignmentFor, recentMovement, windowStatus } from "@/lib/stockCountAssignments";

// Conteo físico de inventario — pedido del usuario 2026-10-02.
// - FULL: conteo general de toda la bodega (una vez). Cuando el admin lo
//   aprueba se guarda PlatformSettings.fullStockCountCompletedAt.
// - WEEKLY_AREA: desde la semana siguiente, un área distinta cada semana
//   (A, B, … G y vuelve a empezar).
// El equipo cuenta A CIEGAS (nunca ve el número del sistema), Daniel revisa
// y envía, el admin aprueba las diferencias en una sola lista.

// variantNames: colores/tallas sugeridos para contar por separado (vacío =
// se cuenta con un solo número, salvo que quien cuenta diga que tiene).
export type CountableProduct = { id: string; name: string; justCode: string | null; photo: string | null; area: string | null; variantNames: string[] };
export type VariantCount = { name: string; qty: number };

// Conteo por color/talla (pedido del usuario 2026-10-06): limpia los nombres
// y no deja repetir el mismo color dos veces.
function cleanVariantCounts(raw: VariantCount[]): { ok: true; list: VariantCount[] } | { ok: false; error: string } {
  const list: VariantCount[] = [];
  for (const v of raw) {
    const name = v.name.replace(/\s+/g, " ").trim();
    if (!name) return { ok: false, error: "Falta el nombre de un color/talla." };
    if (!Number.isInteger(v.qty) || v.qty < 0) return { ok: false, error: `Escribe una cantidad entera, 0 o mayor, para «${name}».` };
    if (list.some((x) => x.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `«${name}» está dos veces: súmalo en una sola.` };
    list.push({ name, qty: v.qty });
  }
  // Lista vacía = no había ninguno (total 0).
  return { ok: true, list };
}

export function parseVariantCounts(json: unknown): VariantCount[] | null {
  return Array.isArray(json) ? (json as VariantCount[]) : null;
}

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
  // Del que menos se vende al que más (el usuario lo cambió el 2026-10-05,
  // primero se pidió al revés).
  const [moved, suggested] = await Promise.all([recentMovement(items.map((i) => i.id)), variantSuggestions(items.map((i) => i.id))]);
  return items
    .map((i) => ({ p: { id: i.id, name: i.name, justCode: i.justCode, photo: i.photos[0] ?? null, area: i.warehouseArea, variantNames: suggested.get(i.id) ?? [] }, moved: moved.get(i.id) ?? 0 }))
    .sort((a, b) => a.moved - b.moved || a.p.name.localeCompare(b.p.name))
    .map((x) => x.p);
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
  // applied = ya se aplicó a INVESTOCK (2026-10-13): no se corrige desde aquí.
  products: (CountableProduct & { countedQty: number | null; variantCounts: VariantCount[] | null; countedByName: string | null; countedAt: string | null; recount: boolean; applied: boolean })[];
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
      return { ...p, countedQty: l?.countedQty ?? null, variantCounts: parseVariantCounts(l?.variantCounts), countedByName: l?.countedById ? (nameOf.get(l.countedById) ?? null) : null, countedAt: l?.countedAt.toISOString() ?? null, recount: l?.decision === RECOUNT, applied: l?.decision === "APPROVED" };
    }),
  };
}

// Quien no es Daniel solo cuenta lo de su área asignada, después de pulsar
// "Empezar" (pedido del usuario 2026-10-05). Daniel puede corregir cualquiera.
// Con `variants` se cuenta por color/talla y el total es la suma.
export async function recordCount(params: { countId: string; catalogItemId: string; quantity: number; variants?: VariantCount[] | null; userId: string | null; isLead: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  let variantCounts: VariantCount[] | null = null;
  if (params.variants) {
    const cleaned = cleanVariantCounts(params.variants);
    if (!cleaned.ok) return cleaned;
    variantCounts = cleaned.list;
    params = { ...params, quantity: variantCounts.reduce((s, v) => s + v.qty, 0) };
  }
  if (!Number.isInteger(params.quantity) || params.quantity < 0) return { ok: false, error: "Escribe una cantidad entera, 0 o mayor." };
  const count = await prisma.stockCount.findUnique({ where: { id: params.countId }, select: { status: true, kind: true, area: true } });
  if (!count) return { ok: false, error: "Conteo no encontrado." };
  const existing = await prisma.stockCountLine.findUnique({ where: { countId_catalogItemId: { countId: params.countId, catalogItemId: params.catalogItemId } } });
  const isRecount = existing?.decision === RECOUNT;
  if (existing?.decision === "APPROVED") return { ok: false, error: "Este producto ya se aplicó a INVESTOCK. Si está mal, corrígelo con «Ajustar (conteo)» en Stock Actual." };
  if (count.status !== "COUNTING" && !(isRecount && count.status === "SUBMITTED")) return { ok: false, error: "Este conteo ya se envió: no se puede cambiar." };
  if (count.kind === "WEEKLY_AREA" && !isRecount) {
    const item = await prisma.purchaseCatalogItem.findUnique({ where: { id: params.catalogItemId }, select: { warehouseArea: true } });
    if (item?.warehouseArea !== count.area) return { ok: false, error: `Este producto no es del área ${count.area}.` };
  }
  const assignment = params.userId ? await openAssignmentFor(params.countId, params.userId) : null;
  const mine = assignment ? (await assignmentProductIds(assignment)).includes(params.catalogItemId) : false;
  if (isRecount && (!assignment || assignment.area !== RECOUNT || !mine)) return { ok: false, error: "Este producto lo vuelve a contar la persona que Daniel asignó para el recuento." };
  if (!params.isLead && !isRecount) {
    if (!assignment) return { ok: false, error: "Todavía no tienes un área asignada. Daniel te la asigna." };
    if (!mine) return { ok: false, error: "Este producto no es de tu área asignada." };
  }
  if (assignment && mine && !assignment.startedAt) return { ok: false, error: "Primero pulsa «Empezar conteo»." };
  // Fuera de los dos horarios solo Daniel puede corregir.
  if (!params.isLead && !windowStatus().inWindow) return { ok: false, error: `El conteo se habilita ${COUNT_HOURS_TEXT}.` };

  const now = new Date();
  // Tiempo de este producto: desde el anterior que contó esta persona.
  let durationSec: number | null = null;
  if (assignment && mine && assignment.lastActivityAt) {
    const gap = Math.round((now.getTime() - assignment.lastActivityAt.getTime()) / 1000);
    durationSec = gap <= MAX_PRODUCT_GAP_SEC ? gap : null;
    await prisma.stockCountAssignment.update({ where: { id: assignment.id }, data: { lastActivityAt: now } });
  }
  // Una corrección no cambia el tiempo que ya se midió.
  const firstTime = !existing || isRecount;
  const expectedQty = await expectedNow(params.catalogItemId);
  const variantJson = variantCounts ?? Prisma.DbNull;
  await prisma.stockCountLine.upsert({
    where: { countId_catalogItemId: { countId: params.countId, catalogItemId: params.catalogItemId } },
    update: { countedQty: params.quantity, variantCounts: variantJson, countedById: params.userId, countedAt: now, expectedQty, ...(isRecount ? { decision: null, decidedAt: null } : {}), ...(firstTime ? { durationSec } : {}) },
    create: { countId: params.countId, catalogItemId: params.catalogItemId, countedQty: params.quantity, variantCounts: variantJson, countedById: params.userId, expectedQty, durationSec },
  });
  if (isRecount) await settleRecount(params.countId, params.catalogItemId, existing.prevDelta, assignment?.id ?? null);
  return { ok: true };
}

// ---- Aplicar lo contado (pedido del usuario 2026-10-13) --------------------
// Ya no espera a que el admin apruebe una lista: Daniel aplica lo contado
// cuando quiere ("Aplicar lo contado a INVESTOCK", también al enviar).
// - Sin diferencia o diferencia pequeña: se aplica sola.
// - Diferencia grande (más de BIG_DIFF_UNITS y más del doble o menos de la
//   mitad de lo esperado, ver stockCountRules.ts): la vuelve a contar OTRA persona. Si el recuento
//   coincide con la diferencia anterior, se aplica solo; si no, otra persona
//   más, hasta que dos conteos seguidos coincidan.
// El admin solo recibe un resumen (con el valor en dinero).
function recountMatches(prevDelta: number, delta: number): boolean {
  return Math.abs(delta - prevDelta) <= Math.max(2, Math.round(Math.abs(prevDelta) * 0.1));
}

type LineForApply = { id: string; countId: string; catalogItemId: string; countedQty: number; expectedQty: number; variantCounts: Prisma.JsonValue; decision: string | null };

// Aplica UNA línea: ajuste en el Kardex sobre el saldo actual (la diferencia
// que había al contar, para no pisar lo que se movió después) y los
// colores/tallas contados. Devuelve el valor del ajuste, o null si otro ya la aplicó.
async function applyLine(l: LineForApply): Promise<{ value: number } | null> {
  const claimed = await prisma.stockCountLine.updateMany({ where: { id: l.id, decision: l.decision }, data: { decision: "APPROVED", decidedAt: new Date() } });
  if (claimed.count === 0) return null;
  const delta = l.countedQty - l.expectedQty;
  let value = 0;
  if (delta !== 0) {
    const current = await getCurrentStock(l.catalogItemId);
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
    value = delta * current.avgCost;
  }
  const counted = parseVariantCounts(l.variantCounts);
  if (counted) await saveLineVariants(l.catalogItemId, counted, l.countId);
  return { value };
}

export type ApplySummary = { applied: number; withDifference: number; valueUp: number; valueDown: number; recount: string[] };

// Procesa todo lo contado que todavía no se aplicó ni está en recuento.
async function processCountedLines(countId: string): Promise<ApplySummary> {
  const lines = await prisma.stockCountLine.findMany({ where: { countId, decision: null }, orderBy: { countedAt: "asc" } });
  const out: ApplySummary = { applied: 0, withDifference: 0, valueUp: 0, valueDown: 0, recount: [] };
  const big: string[] = [];
  for (const l of lines) {
    if (isBigDifference(l.countedQty, l.expectedQty)) {
      const r = await prisma.stockCountLine.updateMany({ where: { id: l.id, decision: null }, data: { decision: RECOUNT, decidedAt: new Date(), prevDelta: l.countedQty - l.expectedQty } });
      if (r.count > 0) big.push(l.catalogItemId);
      continue;
    }
    const r = await applyLine(l);
    if (!r) continue;
    out.applied++;
    if (l.countedQty !== l.expectedQty) out.withDifference++;
    if (r.value > 0) out.valueUp += r.value;
    else out.valueDown += -r.value;
  }
  if (big.length) out.recount = (await prisma.purchaseCatalogItem.findMany({ where: { id: { in: big } }, select: { name: true } })).map((i) => i.name);
  return out;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

async function adminStockHref(): Promise<string> {
  const inv = await prisma.department.findFirst({ where: { code: "INV" }, select: { id: true } });
  return inv ? `/admin/dept/${inv.id}?tab=stock-actual` : "/admin";
}

async function notifyApplySummary(s: ApplySummary, who: string): Promise<void> {
  if (s.applied === 0 && s.recount.length === 0) return;
  const more = s.recount.length > 4 ? ` y ${s.recount.length - 4} más` : "";
  const recount = s.recount.length ? ` ${s.recount.length} con diferencia grande pasan a recuento por otra persona: ${s.recount.slice(0, 4).join("; ")}${more}.` : "";
  await notifyOwner("admin", {
    title: "📋 Conteo físico aplicado a INVESTOCK",
    body: `${who} aplicó ${s.applied} producto(s) (${s.withDifference} con diferencia). Valor del inventario: +${money(s.valueUp)} / −${money(s.valueDown)}.${recount}`,
    url: await adminStockHref(),
  }).catch(() => null);
  const danielId = await getInventoryLeadId();
  if (s.recount.length && danielId) {
    await notifyOwner(danielId, {
      title: "🔁 Diferencias grandes para recontar",
      body: `${s.recount.length} producto(s) tienen una diferencia grande y no se aplicaron. Asigna el recuento a otra persona (no a quien los contó).`,
      url: "/area/conteo-inventario",
    }).catch(() => null);
  }
}

// Botón de Daniel: aplica lo contado hasta ahora sin cerrar el conteo.
export async function applyCountedSoFar(countId: string, who: string): Promise<{ ok: true; summary: ApplySummary } | { ok: false; error: string }> {
  const count = await prisma.stockCount.findUnique({ where: { id: countId }, select: { status: true } });
  if (!count) return { ok: false, error: "Conteo no encontrado." };
  if (count.status === "APPROVED") return { ok: false, error: "Este conteo ya se cerró." };
  const summary = await processCountedLines(countId);
  await notifyApplySummary(summary, who);
  await closeIfSettled(countId);
  return { ok: true, summary };
}

// Al recontar: si coincide con el conteo anterior se aplica; si no, otra
// persona vuelve a contar (sale de esta asignación y queda sin asignar).
async function settleRecount(countId: string, catalogItemId: string, prevDelta: number | null, assignmentId: string | null): Promise<void> {
  const l = await prisma.stockCountLine.findUnique({ where: { countId_catalogItemId: { countId, catalogItemId } } });
  if (!l || l.decision !== null) return;
  const delta = l.countedQty - l.expectedQty;
  const ok = prevDelta === null ? !isBigDifference(l.countedQty, l.expectedQty) : recountMatches(prevDelta, delta);
  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id: catalogItemId }, select: { name: true } });
  if (ok) {
    const r = await applyLine(l);
    if (r && r.value !== 0) {
      await notifyOwner("admin", {
        title: "📋 Recuento confirmado y aplicado",
        body: `${item?.name ?? "Un producto"}: el recuento coincidió (${delta > 0 ? "+" : ""}${delta} u.) y se aplicó a INVESTOCK. Valor: ${r.value > 0 ? "+" : "−"}${money(Math.abs(r.value))}.`,
        url: await adminStockHref(),
      }).catch(() => null);
    }
  } else {
    await prisma.stockCountLine.update({ where: { id: l.id }, data: { decision: RECOUNT, decidedAt: new Date(), prevDelta: delta } });
    if (assignmentId) {
      const a = await prisma.stockCountAssignment.findUnique({ where: { id: assignmentId }, select: { catalogItemIds: true } });
      if (a) await prisma.stockCountAssignment.update({ where: { id: assignmentId }, data: { catalogItemIds: a.catalogItemIds.filter((id) => id !== catalogItemId) } });
    }
    const danielId = await getInventoryLeadId();
    if (danielId) {
      await notifyOwner(danielId, {
        title: "🔁 El recuento no coincidió",
        body: `${item?.name ?? "Un producto"}: el recuento dio distinto al conteo anterior. Asigna otro recuento a una tercera persona.`,
        url: "/area/conteo-inventario",
      }).catch(() => null);
    }
  }
  await closeIfSettled(countId);
}

// Daniel envía: lo contado queda congelado y las diferencias van al admin.
export async function submitCount(countId: string, userId: string | null): Promise<{ ok: true; differences: number; recount: number } | { ok: false; error: string }> {
  const count = await prisma.stockCount.findUnique({ where: { id: countId }, include: { lines: true } });
  if (!count) return { ok: false, error: "Conteo no encontrado." };
  if (count.status !== "COUNTING") return { ok: false, error: "Este conteo ya se envió." };
  if (count.lines.length === 0) return { ok: false, error: "Todavía no se contó nada." };
  await prisma.stockCount.update({ where: { id: countId }, data: { status: "SUBMITTED", submittedAt: new Date(), submittedById: userId } });
  // Lo que quedó sin terminar ya no le sale a nadie en su Inicio; quien
  // estaba a mitad de turno queda con su turno registrado.
  const now = new Date();
  for (const open of await prisma.stockCountAssignment.findMany({ where: { countId, finishedAt: null, startedAt: { not: null } } })) await closeShift(open, now);
  await prisma.stockCountAssignment.updateMany({ where: { countId, finishedAt: null }, data: { finishedAt: new Date() } });
  // 2026-10-13: lo contado se aplica solo (las diferencias grandes, a recuento).
  const who = userId ? ((await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? "Daniel") : "Daniel";
  const summary = await processCountedLines(countId);
  await notifyApplySummary(summary, who);
  await closeIfSettled(countId);
  return { ok: true, differences: summary.withDifference, recount: summary.recount.length };
}

export type DifferenceRow = { lineId: string; catalogItemId: string; name: string; justCode: string | null; area: string | null; expectedQty: number; countedQty: number; diff: number; variantCounts: VariantCount[] | null; countedByName: string | null };

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
    variantCounts: parseVariantCounts(l.variantCounts),
    countedByName: l.countedById ? (user.get(l.countedById) ?? null) : null,
  }));
}

async function finishCount(countId: string, adminId: string | null) {
  const count = await prisma.stockCount.update({ where: { id: countId }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: adminId } });
  if (count.kind === "FULL") {
    await prisma.platformSettings.update({ where: { id: "singleton" }, data: { fullStockCountCompletedAt: new Date() } });
  }
  await saveCountedVariants(countId);
}

// Lo contado por color/talla queda como la lista oficial de variantes del
// producto, con su cantidad (2026-10-06). Lo que el admin dejó "como está"
// (REJECTED) no cuenta. Un color que ya estaba y ahora no apareció queda en 0.
// Desde 2026-10-13 lo aplicado guarda sus colores al aplicarse (applyLine);
// al cerrar solo queda lo que no pasó por ahí.
async function saveCountedVariants(countId: string) {
  const lines = await prisma.stockCountLine.findMany({
    where: { countId, decision: null, NOT: { variantCounts: { equals: Prisma.DbNull } } },
    select: { catalogItemId: true, variantCounts: true },
  });
  for (const l of lines) await saveLineVariants(l.catalogItemId, parseVariantCounts(l.variantCounts) ?? [], countId);
}

async function saveLineVariants(catalogItemId: string, counted: VariantCount[], countId: string) {
  const now = new Date();
  const existing = await prisma.productVariant.findMany({ where: { catalogItemId }, select: { id: true, name: true } });
  await prisma.$transaction([
    ...counted.map((v) => {
      const same = existing.find((e) => e.name.toLowerCase() === v.name.toLowerCase());
      return same
        ? prisma.productVariant.update({ where: { id: same.id }, data: { countedQty: v.qty, countedAt: now } })
        : prisma.productVariant.create({ data: { catalogItemId, name: v.name, countedQty: v.qty, countedAt: now } });
    }),
    ...existing
      .filter((e) => !counted.some((v) => v.name.toLowerCase() === e.name.toLowerCase()))
      .map((e) => prisma.productVariant.update({ where: { id: e.id }, data: { countedQty: 0, countedAt: now } })),
  ]);
  // Stock por variante: cada color queda en lo contado.
  await applyCountToVariants(catalogItemId, counted, countId).catch((e) => console.error("[variant stock count]", e));
}

// El admin aprueba la lista: cada diferencia aprobada se aplica sobre el
// saldo ACTUAL como ajuste por conteo físico (la diferencia que había en el
// momento de contar, no el número contado, para no pisar lo que se movió
// después). Las rechazadas no tocan el stock.
// Lo desmarcado lo vuelve a contar OTRA persona (decisión del usuario
// 2026-10-05), salvo lo que el admin decida "dejar como está".
export async function approveDifferences(params: { countId: string; approveLineIds: string[]; keepLineIds?: string[]; adminId: string | null }): Promise<{ ok: true; applied: number; rejected: number; recount: number } | { ok: false; error: string }> {
  const count = await prisma.stockCount.findUnique({ where: { id: params.countId }, select: { status: true } });
  if (!count) return { ok: false, error: "Conteo no encontrado." };
  if (count.status !== "SUBMITTED") return { ok: false, error: "Este conteo no está esperando aprobación." };
  const pending = (await prisma.stockCountLine.findMany({ where: { countId: params.countId, decision: null } })).filter((l) => l.countedQty !== l.expectedQty);
  const approve = new Set(params.approveLineIds);
  const keep = new Set(params.keepLineIds ?? []);
  let applied = 0;
  let rejected = 0;
  let recount = 0;
  for (const l of pending) {
    if (approve.has(l.id)) {
      if (await applyLine(l)) applied++;
    } else if (keep.has(l.id)) {
      await prisma.stockCountLine.updateMany({ where: { id: l.id, decision: null }, data: { decision: "REJECTED", decidedAt: new Date() } });
      rejected++;
    } else {
      await prisma.stockCountLine.updateMany({ where: { id: l.id, decision: null }, data: { decision: RECOUNT, decidedAt: new Date() } });
      recount++;
    }
  }
  await closeIfSettled(params.countId, params.adminId);
  return { ok: true, applied, rejected, recount };
}

// El conteo se cierra cuando ya no queda nada por recontar ni por aprobar.
export async function closeIfSettled(countId: string, adminId: string | null = null): Promise<void> {
  const count = await prisma.stockCount.findUnique({ where: { id: countId }, select: { status: true } });
  if (count?.status !== "SUBMITTED") return;
  const lines = await prisma.stockCountLine.findMany({ where: { countId, OR: [{ decision: null }, { decision: RECOUNT }] }, select: { decision: true, countedQty: true, expectedQty: true } });
  if (lines.some((l) => l.decision === RECOUNT || l.countedQty !== l.expectedQty)) return;
  await finishCount(countId, adminId);
}

export async function recountPendingCount(countId: string): Promise<number> {
  return prisma.stockCountLine.count({ where: { countId, decision: RECOUNT } });
}

export async function getSubmittedCounts() {
  return prisma.stockCount.findMany({ where: { status: "SUBMITTED" }, orderBy: { submittedAt: "asc" }, select: { id: true, kind: true, area: true, weekStart: true, submittedAt: true } });
}
