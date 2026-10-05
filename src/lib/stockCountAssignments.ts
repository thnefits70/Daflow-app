import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { getInventoryLeadId } from "@/lib/guards";
import { ecuadorDay } from "@/lib/fulfillmentGuides";
import { isWorkingDay } from "@/lib/ecuadorHolidays";
import { WAREHOUSE_AREAS, areaLabel } from "@/lib/warehouseAreas";

// Conteo organizado por áreas — pedido del usuario 2026-10-05:
// - Daniel asigna cada área a UNA persona del equipo de Inventario y elige
//   un bloque de horario entre cortes (la meta para terminar).
// - A la persona le llega el aviso y le sale en su Inicio; al pulsar
//   "Empezar" corre su tiempo; cuenta del producto que más se vende al que
//   menos; al terminar le avisa a Daniel para que asigne la siguiente.
// - Lo que el admin desmarca en la lista de diferencias lo vuelve a contar
//   OTRA persona (área especial "RECOUNT").
// - El tiempo por producto se guarda: en este primer conteo solo se mide;
//   desde que hay historial, el área tiene un tiempo estimado y se avisa a
//   Daniel cuando alguien se pasa.

export const NO_AREA = "NONE";
export const RECOUNT = "RECOUNT";

export function countAreaLabel(area: string): string {
  if (area === RECOUNT) return "Recuento";
  if (area === NO_AREA) return "Sin área";
  return areaLabel(area);
}

// ---- Horarios para contar (entre cortes: 8:30, 12:00 y 14:00) -------------

const EC_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const WEEKDAY_BLOCKS: [number, number, string][] = [
  [8 * 60 + 45, 11 * 60 + 45, "Mañana"],
  [12 * 60 + 15, 13 * 60 + 45, "Mediodía"],
  [14 * 60 + 15, 16 * 60 + 45, "Tarde"],
];
// El sábado hay un solo corte y el equipo trabaja hasta las 12:00.
const SATURDAY_BLOCKS: [number, number, string][] = [[9 * 60, 12 * 60, "Sábado"]];

export type CountWindow = { label: string; start: string; end: string };

function atEcuador(day: string, minutes: number): Date {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + EC_OFFSET_MS + minutes * 60_000);
}

function hhmm(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

function blocksFor(day: string): [number, number, string][] {
  if (!isWorkingDay(day)) return [];
  return new Date(`${day}T12:00:00Z`).getUTCDay() === 6 ? SATURDAY_BLOCKS : WEEKDAY_BLOCKS;
}

// Los próximos bloques que todavía no terminan (para que Daniel elija).
export function upcomingWindows(now = new Date(), howMany = 6): CountWindow[] {
  const out: CountWindow[] = [];
  const today = ecuadorDay(now);
  for (let i = 0; i < 14 && out.length < howMany; i++) {
    const day = new Date(new Date(`${today}T12:00:00Z`).getTime() + i * 86_400_000).toISOString().slice(0, 10);
    const dayLabel = i === 0 ? "Hoy" : `${DAY_NAMES[new Date(`${day}T12:00:00Z`).getUTCDay()]} ${day.split("-").reverse().slice(0, 2).join("/")}`;
    for (const [from, to, name] of blocksFor(day)) {
      const end = atEcuador(day, to);
      if (end <= now) continue;
      out.push({ label: `${dayLabel} · ${name} (${hhmm(from)}–${hhmm(to)})`, start: atEcuador(day, from).toISOString(), end: end.toISOString() });
      if (out.length >= howMany) break;
    }
  }
  return out;
}

// Si ahora es horario de contar, el bloque actual; si no, cuándo sigue.
export function windowStatus(now = new Date()): { inWindow: boolean; endsAt: string | null; nextStart: string | null } {
  const next = upcomingWindows(now, 1)[0];
  if (!next) return { inWindow: false, endsAt: null, nextStart: null };
  const inWindow = new Date(next.start) <= now;
  return { inWindow, endsAt: inWindow ? next.end : null, nextStart: inWindow ? null : next.start };
}

// ---- Movimiento y tiempos -------------------------------------------------

// Unidades que salieron en los últimos 30 días por producto (para ordenar
// del que más se mueve al que menos).
export async function recentMovement(catalogItemIds?: string[]): Promise<Map<string, number>> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await prisma.stockKardexEntry.groupBy({
    by: ["catalogItemId"],
    where: { type: "OUT", occurredAt: { gte: since }, ...(catalogItemIds ? { catalogItemId: { in: catalogItemIds } } : {}) },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.catalogItemId, Math.abs(r._sum.quantity ?? 0)]));
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Tiempo estimado (segundos) para contar estos productos, según conteos
// anteriores. null mientras no haya historial para al menos la mitad.
export async function estimateSeconds(catalogItemIds: string[], excludeCountId: string): Promise<number | null> {
  if (catalogItemIds.length === 0) return null;
  const lines = await prisma.stockCountLine.findMany({
    where: { catalogItemId: { in: catalogItemIds }, durationSec: { not: null }, countId: { not: excludeCountId } },
    select: { catalogItemId: true, durationSec: true },
  });
  const byItem = new Map<string, number[]>();
  for (const l of lines) byItem.set(l.catalogItemId, [...(byItem.get(l.catalogItemId) ?? []), l.durationSec!]);
  if (byItem.size < catalogItemIds.length / 2) return null;
  const perItem = [...byItem.values()].map(median);
  const fallback = median(perItem);
  return Math.round(catalogItemIds.reduce((sum, id) => sum + (byItem.has(id) ? median(byItem.get(id)!) : fallback), 0));
}

// Una pausa de más de 15 min (corte, almuerzo) no cuenta como tiempo del producto.
export const MAX_PRODUCT_GAP_SEC = 15 * 60;

// ---- Quién puede contar ---------------------------------------------------

export async function inventoryTeam(): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({
    where: { isActive: true, OR: [{ department: { code: "INV" } }, { isLeader: true, leadsDept: { code: "INV" } }] },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

// Productos que cubre una asignación.
export async function assignmentProductIds(a: { countId: string; area: string; catalogItemIds: string[] }): Promise<string[]> {
  if (a.area === RECOUNT) return a.catalogItemIds;
  const items = await prisma.purchaseCatalogItem.findMany({ where: { warehouseArea: a.area === NO_AREA ? null : a.area }, select: { id: true } });
  return items.map((i) => i.id);
}

// Áreas que tiene este conteo (el general: A–G y "Sin área" si hay; el
// semanal: solo su área).
export async function countAreas(count: { kind: string; area: string | null }): Promise<string[]> {
  if (count.kind === "WEEKLY_AREA") return count.area ? [count.area] : [];
  const noArea = await prisma.purchaseCatalogItem.count({ where: { warehouseArea: null } });
  return [...WAREHOUSE_AREAS, ...(noArea > 0 ? [NO_AREA] : [])];
}

export async function openAssignmentFor(countId: string, userId: string) {
  return prisma.stockCountAssignment.findFirst({ where: { countId, assigneeId: userId, finishedAt: null }, orderBy: { assignedAt: "asc" } });
}

// ---- Asignar / empezar / terminar -----------------------------------------

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function assignArea(params: { countId: string; area: string; assigneeId: string; dueAt: string; byId: string | null }): Promise<Result> {
  const count = await prisma.stockCount.findUnique({ where: { id: params.countId }, select: { id: true, kind: true, area: true, status: true } });
  if (!count) return { ok: false, error: "Conteo no encontrado." };
  const isRecount = params.area === RECOUNT;
  if (isRecount ? count.status !== "SUBMITTED" : count.status !== "COUNTING") return { ok: false, error: "Este conteo ya no está abierto para asignar." };
  if (!isRecount && !(await countAreas(count)).includes(params.area)) return { ok: false, error: "Esa área no es de este conteo." };

  const team = await inventoryTeam();
  const person = team.find((t) => t.id === params.assigneeId);
  if (!person) return { ok: false, error: "Elige a alguien del equipo de Inventario." };
  const window = upcomingWindows(new Date(), 20).find((w) => w.end === params.dueAt);
  if (!window) return { ok: false, error: "Elige uno de los horarios para contar." };

  const busy = await prisma.stockCountAssignment.findFirst({ where: { countId: count.id, assigneeId: person.id, finishedAt: null, NOT: { area: params.area } } });
  if (busy) return { ok: false, error: `${person.name} ya está contando ${countAreaLabel(busy.area)}: una persona, un área a la vez.` };

  let catalogItemIds: string[] = [];
  if (isRecount) {
    const taken = new Set((await prisma.stockCountAssignment.findMany({ where: { countId: count.id, area: RECOUNT, finishedAt: null }, select: { catalogItemIds: true } })).flatMap((a) => a.catalogItemIds));
    const lines = await prisma.stockCountLine.findMany({ where: { countId: count.id, decision: "RECOUNT" }, select: { catalogItemId: true, countedById: true } });
    const free = lines.filter((l) => !taken.has(l.catalogItemId));
    if (free.length === 0) return { ok: false, error: "No hay productos por recontar sin asignar." };
    // Lo vuelve a contar OTRA persona (decisión del usuario 2026-10-05).
    if (free.some((l) => l.countedById === person.id)) return { ok: false, error: `${person.name} contó alguno de estos productos: elige a otra persona para el recuento.` };
    catalogItemIds = free.map((l) => l.catalogItemId);
  }

  const existing = isRecount ? null : await prisma.stockCountAssignment.findFirst({ where: { countId: count.id, area: params.area, finishedAt: null } });
  if (!isRecount && (await prisma.stockCountAssignment.findFirst({ where: { countId: count.id, area: params.area, finishedAt: { not: null } } }))) {
    return { ok: false, error: `${countAreaLabel(params.area)} ya se terminó de contar.` };
  }
  const previousAssignee = existing?.assigneeId ?? null;
  if (existing) {
    await prisma.stockCountAssignment.update({ where: { id: existing.id }, data: { assigneeId: person.id, assignedById: params.byId, assignedAt: new Date(), dueAt: new Date(window.end), lateNotifiedAt: null, ...(previousAssignee !== person.id ? { startedAt: null, lastActivityAt: null } : {}) } });
  } else {
    await prisma.stockCountAssignment.create({ data: { countId: count.id, area: params.area, catalogItemIds, assigneeId: person.id, assignedById: params.byId, dueAt: new Date(window.end) } });
  }

  const what = isRecount ? `recontar ${catalogItemIds.length} producto(s)` : `contar ${countAreaLabel(params.area)}`;
  if (previousAssignee !== person.id) {
    await notifyOwner(person.id, { title: "📋 Te toca contar inventario", body: `Daniel te asignó ${what}. Horario: ${window.label}. Empieza cuando termines de sacar el corte.`, url: "/area/conteo-inventario" }).catch(() => null);
    if (previousAssignee) await notifyOwner(previousAssignee, { title: "📋 Conteo reasignado", body: `${countAreaLabel(params.area)} ahora lo cuenta ${person.name}. Ya no te toca.`, url: "/area/conteo-inventario" }).catch(() => null);
  }
  return { ok: true };
}

export async function startAssignment(id: string, userId: string): Promise<Result> {
  const a = await prisma.stockCountAssignment.findUnique({ where: { id } });
  if (!a || a.assigneeId !== userId) return { ok: false, error: "Este conteo no está asignado a ti." };
  if (a.finishedAt) return { ok: false, error: "Ya terminaste este conteo." };
  if (!a.startedAt) await prisma.stockCountAssignment.update({ where: { id }, data: { startedAt: new Date(), lastActivityAt: new Date() } });
  return { ok: true };
}

export async function assignmentProgress(a: { countId: string; area: string; catalogItemIds: string[] }): Promise<{ done: number; total: number; ids: string[] }> {
  const ids = await assignmentProductIds(a);
  const where = a.area === RECOUNT ? { countId: a.countId, catalogItemId: { in: ids }, decision: { not: "RECOUNT" } } : { countId: a.countId, catalogItemId: { in: ids } };
  const done = await prisma.stockCountLine.count({ where });
  return { done, total: ids.length, ids };
}

function minutesBetween(from: Date | null, to: Date): number {
  return from ? Math.max(1, Math.round((to.getTime() - from.getTime()) / 60_000)) : 0;
}

export async function finishAssignment(id: string, userId: string, closeIfSettled: (countId: string) => Promise<void>): Promise<Result> {
  const a = await prisma.stockCountAssignment.findUnique({ where: { id } });
  if (!a || a.assigneeId !== userId) return { ok: false, error: "Este conteo no está asignado a ti." };
  if (a.finishedAt) return { ok: true };
  const p = await assignmentProgress(a);
  if (p.done < p.total) return { ok: false, error: `Te faltan ${p.total - p.done} producto(s) por contar. Si alguno no está, escribe 0.` };
  const now = new Date();
  await prisma.stockCountAssignment.update({ where: { id }, data: { finishedAt: now } });
  const who = (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? "Alguien";
  const mins = minutesBetween(a.startedAt, now);
  const danielId = await getInventoryLeadId();
  if (a.area === RECOUNT) {
    await notifyOwner("admin", { title: "📋 Recuento terminado", body: `${who} volvió a contar ${p.total} producto(s). Revisa la lista de diferencias en Stock Actual.`, url: await adminStockHref() }).catch(() => null);
    await closeIfSettled(a.countId);
  } else if (danielId) {
    const left = await areasWithoutAssignment(a.countId);
    await notifyOwner(danielId, {
      title: "✅ Área contada",
      body: `${who} terminó ${countAreaLabel(a.area)} (${p.total} productos) en ${mins} min.${left.length ? ` Asigna la siguiente: faltan ${left.map(countAreaLabel).join(", ")}.` : " Ya no quedan áreas por asignar."}`,
      url: "/area/conteo-inventario",
    }).catch(() => null);
  }
  return { ok: true };
}

async function adminStockHref(): Promise<string> {
  const inv = await prisma.department.findFirst({ where: { code: "INV" }, select: { id: true } });
  return inv ? `/admin/dept/${inv.id}?tab=stock-actual` : "/admin";
}

export async function areasWithoutAssignment(countId: string): Promise<string[]> {
  const count = await prisma.stockCount.findUnique({ where: { id: countId }, select: { kind: true, area: true } });
  if (!count) return [];
  const assigned = new Set((await prisma.stockCountAssignment.findMany({ where: { countId, NOT: { area: RECOUNT } }, select: { area: true } })).map((a) => a.area));
  return (await countAreas(count)).filter((a) => !assigned.has(a));
}

// Productos que el admin mandó a recontar y que nadie tiene asignados.
export async function unassignedRecountCount(countId: string): Promise<number> {
  const taken = new Set((await prisma.stockCountAssignment.findMany({ where: { countId, area: RECOUNT, finishedAt: null }, select: { catalogItemIds: true } })).flatMap((a) => a.catalogItemIds));
  const lines = await prisma.stockCountLine.findMany({ where: { countId, decision: "RECOUNT" }, select: { catalogItemId: true } });
  return lines.filter((l) => !taken.has(l.catalogItemId)).length;
}

// Meta de la asignación: el fin del bloque; si ya hay tiempo estimado y la
// persona empezó, lo que llegue primero (estimado + 25 % de margen).
export function deadlineOf(a: { dueAt: Date; startedAt: Date | null }, estimateSec: number | null): Date {
  if (!a.startedAt || estimateSec === null) return a.dueAt;
  const byEstimate = new Date(a.startedAt.getTime() + estimateSec * 1250);
  return byEstimate < a.dueAt ? byEstimate : a.dueAt;
}

// Avisa UNA vez a Daniel por cada área que no se terminó a tiempo. Se llama
// cuando alguien abre el conteo o el Inicio (no hay cron cada minuto).
export async function notifyLateAssignments(): Promise<void> {
  const open = await prisma.stockCountAssignment.findMany({ where: { finishedAt: null, lateNotifiedAt: null, count: { status: { not: "APPROVED" } } } });
  if (open.length === 0) return;
  const danielId = await getInventoryLeadId();
  const now = new Date();
  for (const a of open) {
    const ids = await assignmentProductIds(a);
    const deadline = deadlineOf(a, await estimateSeconds(ids, a.countId));
    if (deadline > now) continue;
    const claimed = await prisma.stockCountAssignment.updateMany({ where: { id: a.id, lateNotifiedAt: null }, data: { lateNotifiedAt: now } });
    if (claimed.count === 0 || !danielId) continue;
    const [p, who] = await Promise.all([assignmentProgress(a), prisma.user.findUnique({ where: { id: a.assigneeId }, select: { name: true } })]);
    await notifyOwner(danielId, {
      title: "⏰ Conteo atrasado",
      body: `${who?.name ?? "Alguien"} no terminó ${countAreaLabel(a.area)} a tiempo: lleva ${p.done} de ${p.total}${a.startedAt ? "" : " y todavía no empieza"}. Revisa si necesita ayuda o cámbialo de horario.`,
      url: "/area/conteo-inventario",
    }).catch(() => null);
  }
}

// ---- Lo que ve cada uno en la pantalla del conteo -------------------------

export type AssignmentView = {
  id: string;
  area: string;
  label: string;
  assigneeId: string;
  assigneeName: string;
  done: number;
  total: number;
  productIds: string[];
  assignedAt: string;
  dueAt: string;
  deadline: string;
  startedAt: string | null;
  finishedAt: string | null;
  estimateSec: number | null;
  late: boolean;
};

async function toView(a: Awaited<ReturnType<typeof prisma.stockCountAssignment.findFirstOrThrow>>, names: Map<string, string>): Promise<AssignmentView> {
  const [p, estimateSec] = await Promise.all([assignmentProgress(a), assignmentProductIds(a).then((ids) => estimateSeconds(ids, a.countId))]);
  const deadline = deadlineOf(a, estimateSec);
  return {
    id: a.id,
    area: a.area,
    label: countAreaLabel(a.area),
    assigneeId: a.assigneeId,
    assigneeName: names.get(a.assigneeId) ?? "—",
    done: p.done,
    total: p.total,
    productIds: p.ids,
    assignedAt: a.assignedAt.toISOString(),
    dueAt: a.dueAt.toISOString(),
    deadline: deadline.toISOString(),
    startedAt: a.startedAt?.toISOString() ?? null,
    finishedAt: a.finishedAt?.toISOString() ?? null,
    estimateSec,
    late: !a.finishedAt && deadline < new Date(),
  };
}

export type AssignmentBoard = {
  mine: AssignmentView | null;
  areas: { area: string; label: string; total: number; assignment: AssignmentView | null }[];
  recounts: AssignmentView[];
  unassignedRecount: number;
  team: { id: string; name: string }[];
  windows: CountWindow[];
  window: ReturnType<typeof windowStatus>;
};

export async function getAssignmentBoard(count: { id: string; kind: string; area: string | null }, userId: string | null, isLead: boolean): Promise<AssignmentBoard> {
  const [all, team] = await Promise.all([prisma.stockCountAssignment.findMany({ where: { countId: count.id }, orderBy: { assignedAt: "asc" } }), inventoryTeam()]);
  const names = new Map(team.map((t) => [t.id, t.name]));
  const views = await Promise.all(all.map((a) => toView(a, names)));
  const mine = (userId && views.find((v) => v.assigneeId === userId && !v.finishedAt)) || null;
  if (!isLead) return { mine, areas: [], recounts: [], unassignedRecount: 0, team: [], windows: [], window: windowStatus() };
  const areas = await Promise.all(
    (await countAreas(count)).map(async (area) => ({
      area,
      label: countAreaLabel(area),
      total: (await assignmentProductIds({ countId: count.id, area, catalogItemIds: [] })).length,
      // La más reciente de esa área (si se reasignó, la vigente).
      assignment: [...views].reverse().find((v) => v.area === area) ?? null,
    })),
  );
  return {
    mine,
    areas,
    recounts: views.filter((v) => v.area === RECOUNT),
    unassignedRecount: await unassignedRecountCount(count.id),
    team,
    windows: upcomingWindows(),
    window: windowStatus(),
  };
}
