import { prisma } from "@/lib/prisma";
import { getFinanceLeadId } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";
import { notifyOwner } from "@/lib/notifications";
import { isBusinessDay } from "@/lib/recognition";

// Mismo truco de desplazamiento que src/lib/businessHours.ts: restar el
// offset antes de leer con getUTC* hace que esos getters devuelvan la hora
// de Ecuador; sumar el offset de vuelta convierte a instante UTC real.
const ECUADOR_OFFSET_MS = 5 * 60 * 60 * 1000;

// Semana calendario lunes-sábado (confirmado 2026-08-21) en la que cae `d`,
// medida en hora de Ecuador. weekEnd es el último instante del sábado
// (23:59:59.999) — pasado ese instante la semana ya se puede cerrar.
export function getEcuadorWeekBounds(d: Date): { weekStart: Date; weekEnd: Date } {
  const shifted = new Date(d.getTime() - ECUADOR_OFFSET_MS);
  const day = shifted.getUTCDay(); // 0=domingo..6=sábado
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(shifted);
  monday.setUTCDate(monday.getUTCDate() - diffToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  const saturday = new Date(monday);
  saturday.setUTCDate(saturday.getUTCDate() + 5);
  saturday.setUTCHours(23, 59, 59, 999);
  return { weekStart: new Date(monday.getTime() + ECUADOR_OFFSET_MS), weekEnd: new Date(saturday.getTime() + ECUADOR_OFFSET_MS) };
}

// Confirmado 2026-08-19: mismo patrón atómico que nextPurchaseRequestNumber
// — contador único en PlatformSettings, incrementado dentro de una
// transacción para que nunca se repita aunque dos colaboradores abran un
// lote al mismo tiempo.
export async function nextMerchandiseReentryNumber(): Promise<number> {
  const updated = await prisma.platformSettings.update({
    where: { id: "singleton" },
    data: { lastMerchandiseReentryNumber: { increment: 1 } },
  });
  return updated.lastMerchandiseReentryNumber;
}

export function formatMerchandiseReentryCode(batchNumber: number): string {
  return `RM-${String(batchNumber).padStart(4, "0")}`;
}

// Confirmado 2026-08-23: para no subir a Just en lotes chicos uno por uno,
// un producto con MÁS de esta cantidad de unidades buenas se puede subir
// apenas esté listo; con esta cantidad o menos, espera al último día
// laboral de la semana (ver isTodayLastBusinessDayOfWeek) para juntarse
// con el resto de lo chico y subirse todo junto.
export const JUST_UPLOAD_MIN_QTY = 10;

function todayEcuadorMidnightUTC(): Date {
  const now = new Date(Date.now() - ECUADOR_OFFSET_MS);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// Semana laboral administrativa lunes-viernes (distinta del horario real de
// tienda que sí abre el sábado — ver businessHours.ts) para la regla de
// "subir lo chico a Just una vez por semana". Si el viernes es feriado
// ecuatoriano, retrocede al día laboral anterior — mismo patrón que
// celebrationDateFor() en birthdays.ts.
export function lastBusinessDayOfWeek(d: Date): Date {
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // lunes=0 .. domingo=6
  let friday = new Date(d.getTime() + (4 - daysSinceMonday) * 86400000);
  while (!isBusinessDay(friday)) friday = new Date(friday.getTime() - 86400000);
  return friday;
}

export function isTodayLastBusinessDayOfWeek(): boolean {
  const today = todayEcuadorMidnightUTC();
  return lastBusinessDayOfWeek(today).getTime() === today.getTime();
}

// Bolsa semanal donde caen las unidades "no solucionadas" (ver
// MerchandiseReentryItem.damageSolved) hasta el corte del sábado. Si la
// bolsa natural de la semana actual ya fue cerrada por Daniel
// (justWrittenOffAt), no le sigue metiendo ítems nuevos — los manda a la
// semana siguiente, para no reabrir un lote que Nairoby ya puede estar
// verificando.
export async function getOrCreateCurrentWeekWriteOffBatch() {
  let { weekStart, weekEnd } = getEcuadorWeekBounds(new Date());
  for (let guard = 0; guard < 52; guard++) {
    const existing = await prisma.merchandiseWeeklyWriteOffBatch.findUnique({ where: { weekStart } });
    if (existing && !existing.justWrittenOffAt) return existing;
    if (!existing) {
      const created = await prisma.merchandiseWeeklyWriteOffBatch
        .create({ data: { weekStart, weekEnd } })
        .catch(() => null);
      if (created) return created;
      continue; // carrera con otro request creando la misma semana — reintenta la lectura
    }
    // la semana natural ya fue cerrada por Daniel — pasa a la siguiente
    const nextMonday = new Date(weekStart);
    nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
    ({ weekStart, weekEnd } = getEcuadorWeekBounds(nextMonday));
  }
  throw new Error("No se pudo asignar un lote semanal de baja.");
}

// Un item está "resuelto" para efectos de que Daniel pueda terminar de
// aprobar el lote cuando: (a) no necesitaba revisión manual (IA lo
// reconoció y no trae unidades dañadas) — se resuelve solo, de un clic en
// bloque — o (b) sí la necesitaba y ya se resolvió: tiene un nombre final
// (declarado o corregido) y, si tenía unidades dañadas, ya se decidió
// damageConfirmed (true o false, no null).
export function itemNeedsReview(item: { aiRecognized: boolean; damagedQty: number; correctedName: string | null; damageConfirmed: boolean | null }): boolean {
  const nameNeedsReview = !item.aiRecognized && !item.correctedName;
  const damageNeedsReview = item.damagedQty > 0 && item.damageConfirmed === null;
  return nameNeedsReview || damageNeedsReview;
}

// Nombre final a mostrarle a Daniel/Nairoby/Historial: la corrección de
// Daniel manda si existe, si no el nombre del catálogo (match de IA), si no
// el nombre puesto a mano por el colaborador.
export function itemDisplayName(item: { correctedName: string | null; catalogItem: { name: string } | null; declaredName: string | null }): string {
  return item.correctedName ?? item.catalogItem?.name ?? item.declaredName ?? "Producto sin nombre";
}

// Una vez que TODOS los items de un lote tienen approvedAt, el lote entero
// queda aprobado por Daniel — llamar después de cualquier acción que
// resuelva un item, para saber si hay que marcar danielApprovedAt. Avisa a
// Nairoby en el momento exacto en que el lote pasa a estar listo para ella,
// no en cada aprobación individual de item.
export async function maybeMarkBatchApproved(batchId: string) {
  const items = await prisma.merchandiseReentryItem.findMany({ where: { batchId }, select: { approvedAt: true } });
  if (items.length === 0 || items.some((i) => !i.approvedAt)) return;

  const batch = await prisma.merchandiseReentryBatch
    .update({ where: { id: batchId, danielApprovedAt: null }, data: { danielApprovedAt: new Date() } })
    .catch(() => null); // ya estaba marcado — no pasa nada
  if (!batch) return;

  const leadId = await getFinanceLeadId();
  if (leadId) {
    await sendPushToOwner(leadId, {
      title: "Reingreso de mercadería listo para cerrar",
      body: `${batch.code} — Daniel ya aprobó todo, listo para subir a Just o dar de baja.`,
      url: "/area/reingreso-mercaderia?tab=cierre",
    }).catch(() => null);
  }
}

export type MerchandiseReentryItemForGrouping = {
  id: string;
  batchId: string;
  createdAt: Date;
  goodQty: number;
  damagedQty: number;
  photoUrls: string[];
  correctedName: string | null;
  declaredName: string | null;
  catalogItem: { name: string } | null;
  damageReason: { name: string } | null;
  damageReasonOther: string | null;
  batch: { code: string };
};

// Nairoby ya no confirma item por item: productos con el mismo nombre final
// (misma lógica que itemDisplayName, sin importar de qué lote RM vengan) se
// agrupan en una sola tarjeta con la suma de unidades, para un solo clic en
// vez de repetir la acción por cada ocurrencia del mismo producto. Orden
// confirmado 2026-08-23: de mayor a menor cantidad — los lotes grandes (que
// se pueden subir de inmediato) quedan arriba, los chicos (que esperan al
// último día laboral) abajo.
export function groupItemsForJustUpload(items: MerchandiseReentryItemForGrouping[]) {
  const groups = new Map<string, { name: string; totalGoodQty: number; earliestAt: Date; itemIds: string[]; breakdown: { id: string; batchCode: string; goodQty: number; createdAt: Date }[] }>();
  for (const item of items) {
    const name = itemDisplayName(item);
    const g = groups.get(name) ?? { name, totalGoodQty: 0, earliestAt: item.createdAt, itemIds: [], breakdown: [] };
    g.totalGoodQty += item.goodQty;
    if (item.createdAt < g.earliestAt) g.earliestAt = item.createdAt;
    g.itemIds.push(item.id);
    g.breakdown.push({ id: item.id, batchCode: item.batch.code, goodQty: item.goodQty, createdAt: item.createdAt });
    groups.set(name, g);
  }
  return [...groups.values()].sort((a, b) => b.totalGoodQty - a.totalGoodQty);
}

export function groupItemsForWriteOff(items: MerchandiseReentryItemForGrouping[]) {
  const groups = new Map<
    string,
    { name: string; totalDamagedQty: number; earliestAt: Date; damageReasonLabel: string | null; photoUrl: string | null; itemIds: string[]; breakdown: { id: string; batchCode: string; damagedQty: number; createdAt: Date }[] }
  >();
  for (const item of items) {
    const name = itemDisplayName(item);
    const g = groups.get(name) ?? {
      name,
      totalDamagedQty: 0,
      earliestAt: item.createdAt,
      damageReasonLabel: item.damageReason?.name ?? item.damageReasonOther ?? null,
      photoUrl: item.photoUrls[0] ?? null,
      itemIds: [],
      breakdown: [],
    };
    g.totalDamagedQty += item.damagedQty;
    if (item.createdAt < g.earliestAt) g.earliestAt = item.createdAt;
    if (!g.photoUrl && item.photoUrls[0]) g.photoUrl = item.photoUrls[0];
    g.itemIds.push(item.id);
    g.breakdown.push({ id: item.id, batchCode: item.batch.code, damagedQty: item.damagedQty, createdAt: item.createdAt });
    groups.set(name, g);
  }
  return [...groups.values()].sort((a, b) => a.earliestAt.getTime() - b.earliestAt.getTime());
}

// Una vez que TODA parte relevante de TODOS los items de un lote está
// cerrada por Nairoby (buena subida a Just si goodQty>0, dañada dada de
// baja si quedó damageConfirmed=true), el lote entero se cierra.
export async function maybeMarkBatchClosed(batchId: string) {
  const items = await prisma.merchandiseReentryItem.findMany({
    where: { batchId },
    select: { goodQty: true, damagedQty: true, damageConfirmed: true, justUploadedAt: true, writeOffAt: true },
  });
  if (items.length === 0) return;
  const allClosed = items.every((i) => {
    const goodDone = i.goodQty <= 0 || !!i.justUploadedAt;
    const damagedDone = !(i.damagedQty > 0 && i.damageConfirmed === true) || !!i.writeOffAt;
    return goodDone && damagedDone;
  });
  if (!allClosed) return;
  await prisma.merchandiseReentryBatch.update({
    where: { id: batchId, closedAt: null },
    data: { closedAt: new Date() },
  }).catch(() => null);
}

function fmtShortDate(d: Date): string {
  return d.toLocaleDateString("es-EC", { day: "2-digit", month: "short", timeZone: "America/Guayaquil" });
}

// Daniel solucionó una unidad dañada con un repuesto — el admin queda al
// tanto de la explicación para supervisar la operación (pedido explícito
// 2026-08-21).
export async function notifyAdminDamageSolved(productName: string, note: string) {
  await notifyOwner("admin", {
    title: "Producto dañado solucionado",
    body: `${productName} — se rehabilitó con un repuesto: ${note}`,
    url: "/admin/reingreso-mercaderia?tab=revision",
  }).catch(() => null);
}

// Daniel cerró el corte semanal (ya dio de baja en Just) — le toca a
// Nairoby verificar físicamente y hacer la doble confirmación.
export async function notifyFinanceLeadWeeklyBatchReady(batch: { id: string; weekStart: Date; weekEnd: Date }) {
  const leadId = await getFinanceLeadId();
  if (!leadId) return;
  await notifyOwner(leadId, {
    title: "Lote semanal de productos dañados listo para verificar",
    body: `Semana ${fmtShortDate(batch.weekStart)}–${fmtShortDate(batch.weekEnd)} — Daniel ya dio de baja en Just, falta tu verificación.`,
    url: "/area/reingreso-mercaderia?tab=danos",
  }).catch(() => null);
}
