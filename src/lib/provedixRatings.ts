import { prisma } from "@/lib/prisma";
import { PUBLIC_MIN_AVG, PUBLIC_MIN_RATINGS, RATING_TOOLS, type RatingTool } from "@/lib/provedixRatingTools";

export { isRatingTool } from "@/lib/provedixRatingTools";

// Calificaciones de provedix.com (pedido del usuario 2026-10-15): cada
// registrado califica la herramienta que usó (1 a 5 estrellas + comentario
// opcional). Solo el admin las ve. Más adelante, cuando haya buena nota y
// comentarios reales, se podrán mostrar en la página (solo los que dieron
// permiso, y el promedio siempre el real).

// No se vuelve a preguntar por la misma herramienta en 30 días.
export const RATING_COOLDOWN_DAYS = 30;

export async function ratedRecently(leadId: string, tool: RatingTool): Promise<boolean> {
  const since = new Date(Date.now() - RATING_COOLDOWN_DAYS * 86_400_000);
  const n = await prisma.provedixRating.count({ where: { leadId, tool, createdAt: { gte: since } } });
  return n > 0;
}

export type RatingToolStat = {
  tool: RatingTool;
  label: string;
  count: number; // calificaciones (la última de cada persona)
  avg: number | null;
  last30Count: number;
  last30Avg: number | null;
  dist: number[]; // [1★, 2★, 3★, 4★, 5★]
};

export type RatingWeek = { week: string; count: number; avg: number };

export type RatingComment = {
  id: string;
  tool: RatingTool;
  stars: number;
  comment: string;
  allowPublic: boolean;
  name: string;
  storeName: string | null;
  createdAt: string;
};

export type RatingsOverview = {
  total: number;
  avg: number | null;
  readyForPublic: boolean;
  publicComments: number;
  tools: RatingToolStat[];
  weeks: RatingWeek[];
  comments: RatingComment[];
};

function mean(xs: number[]): number | null {
  return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
}

// Lunes de la semana (fecha de Ecuador, UTC-5) en YYYY-MM-DD.
function weekOf(d: Date): string {
  const ec = new Date(d.getTime() - 5 * 3_600_000);
  const dow = (ec.getUTCDay() + 6) % 7;
  ec.setUTCDate(ec.getUTCDate() - dow);
  return ec.toISOString().slice(0, 10);
}

export async function getRatingsOverview(): Promise<RatingsOverview> {
  const rows = await prisma.provedixRating.findMany({
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: {
      id: true,
      leadId: true,
      tool: true,
      stars: true,
      comment: true,
      allowPublic: true,
      createdAt: true,
      lead: { select: { name: true, storeName: true } },
    },
  });

  // Promedio por herramienta = la ÚLTIMA nota de cada persona (si vuelve a
  // calificar, cuenta su opinión de hoy, no se suma dos veces).
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = `${r.leadId}|${r.tool}`;
    if (!latest.has(k)) latest.set(k, r);
  }
  const current = [...latest.values()];
  const since30 = Date.now() - 30 * 86_400_000;

  const tools: RatingToolStat[] = (Object.keys(RATING_TOOLS) as RatingTool[]).map((tool) => {
    const mine = current.filter((r) => r.tool === tool);
    const recent = rows.filter((r) => r.tool === tool && r.createdAt.getTime() >= since30);
    const dist = [0, 0, 0, 0, 0];
    for (const r of mine) dist[Math.min(5, Math.max(1, r.stars)) - 1]++;
    return {
      tool,
      label: RATING_TOOLS[tool],
      count: mine.length,
      avg: mean(mine.map((r) => r.stars)),
      last30Count: recent.length,
      last30Avg: mean(recent.map((r) => r.stars)),
      dist,
    };
  });

  // Cómo va semana a semana (todas las calificaciones de esa semana), últimas 8.
  const byWeek = new Map<string, number[]>();
  for (const r of rows) {
    const w = weekOf(r.createdAt);
    byWeek.set(w, [...(byWeek.get(w) ?? []), r.stars]);
  }
  const weeks = [...byWeek.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 8)
    .map(([week, xs]) => ({ week, count: xs.length, avg: mean(xs) ?? 0 }));

  // Comentarios: las notas bajas primero (ahí está lo que hay que mejorar),
  // y dentro de cada nota, los más nuevos.
  const comments: RatingComment[] = rows
    .filter((r) => r.comment)
    .sort((a, b) => a.stars - b.stars || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 200)
    .map((r) => ({
      id: r.id,
      tool: r.tool as RatingTool,
      stars: r.stars,
      comment: r.comment!,
      allowPublic: r.allowPublic,
      name: r.lead.name,
      storeName: r.lead.storeName,
      createdAt: r.createdAt.toISOString(),
    }));

  const avg = mean(current.map((r) => r.stars));
  return {
    total: current.length,
    avg,
    readyForPublic: current.length >= PUBLIC_MIN_RATINGS && (avg ?? 0) >= PUBLIC_MIN_AVG,
    publicComments: current.filter((r) => r.allowPublic && r.comment && r.stars >= 4).length,
    tools,
    weeks,
    comments,
  };
}
