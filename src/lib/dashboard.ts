import { prisma } from "@/lib/prisma";

function pct(a: number, b: number) {
  return b === 0 ? 0 : Math.round((a / b) * 100);
}

export type DashboardRow = {
  dept: { id: string; name: string; code: string };
  procs: number;
  docs: number;
  examCount: number;
  attempts: number;
  avg: number | null;
  ranking: { user: string; avg: number; attempts: number }[];
  leader: { name: string; photoUrl: string | null } | null;
};

export type DashboardData = {
  rows: DashboardRow[];
  rowsSorted: DashboardRow[];
  totalAttempts: number;
  overallAvg: number | null;
};

export async function getDashboardData(): Promise<DashboardData> {
  const [departments, processes, documents, exams, scores] = await Promise.all([
    prisma.department.findMany({
      where: { isSpecial: false },
      orderBy: { order: "asc" },
      include: { leaders: { select: { name: true, photoUrl: true }, take: 1 } },
    }),
    prisma.process.findMany({ select: { deptId: true } }),
    prisma.document.findMany({ where: { deptId: { not: null } }, select: { deptId: true } }),
    prisma.exam.findMany({ select: { id: true, deptId: true } }),
    prisma.examScore.findMany({ select: { examId: true, userName: true, score: true, total: true } }),
  ]);

  const examToDept = new Map(exams.map((e) => [e.id, e.deptId]));

  const rows: DashboardRow[] = departments.map((dept) => {
    const procs = processes.filter((p) => p.deptId === dept.id).length;
    const docs = documents.filter((d) => d.deptId === dept.id).length;
    const examCount = exams.filter((e) => e.deptId === dept.id).length;
    const deptScores = scores.filter((s) => examToDept.get(s.examId) === dept.id);

    const avg = deptScores.length
      ? Math.round(deptScores.reduce((a, s) => a + pct(s.score, s.total), 0) / deptScores.length)
      : null;

    const byUser = new Map<string, number[]>();
    for (const s of deptScores) {
      const key = s.userName || "Sin nombre";
      if (!byUser.has(key)) byUser.set(key, []);
      byUser.get(key)!.push(pct(s.score, s.total));
    }
    const ranking = [...byUser.entries()]
      .map(([user, arr]) => ({
        user,
        avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
        attempts: arr.length,
      }))
      .sort((a, b) => b.avg - a.avg);

    const leader = dept.leaders[0] ? { name: dept.leaders[0].name, photoUrl: dept.leaders[0].photoUrl } : null;

    return { dept: { id: dept.id, name: dept.name, code: dept.code }, procs, docs, examCount, attempts: deptScores.length, avg, ranking, leader };
  });

  const rowsSorted = [...rows].sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));
  const totalAttempts = rows.reduce((a, r) => a + r.attempts, 0);
  const ranked = rows.filter((r) => r.avg !== null);
  const overallAvg = ranked.length ? Math.round(ranked.reduce((a, r) => a + (r.avg ?? 0), 0) / ranked.length) : null;

  return { rows, rowsSorted, totalAttempts, overallAvg };
}

export type WeeklyTrend = { deptName: string; points: { week: string; value: number; detail?: string }[] } | null;

// Shared by both the admin dashboard and every employee's Inicio — whichever
// department has trackWeeklyMetric on (currently just Fulfillment).
export async function getWeeklyTrend(): Promise<WeeklyTrend> {
  const dept = await prisma.department.findFirst({ where: { trackWeeklyMetric: true } });
  if (!dept) return null;

  const records = await prisma.weeklyMetricRecord.findMany({
    where: { deptId: dept.id },
    orderBy: { week: "asc" },
  });
  if (records.length === 0) return null;

  return {
    deptName: dept.name,
    points: records.map((r) => ({ week: r.week, value: r.value })),
  };
}

// Fill Rate = pedidos despachados / (despachados + no despachados) * 100 — only
// computed for weeks where "no despachados" was actually entered.
export async function getFillRateTrend(): Promise<WeeklyTrend> {
  const dept = await prisma.department.findFirst({ where: { trackWeeklyMetric: true } });
  if (!dept) return null;

  const records = await prisma.weeklyMetricRecord.findMany({
    where: { deptId: dept.id, notDispatched: { not: null } },
    orderBy: { week: "asc" },
  });
  if (records.length === 0) return null;

  const points = records
    .map((r) => {
      const notDispatched = r.notDispatched ?? 0;
      const total = r.value + notDispatched;
      if (total === 0) return null;
      return {
        week: r.week,
        value: Math.round((r.value / total) * 100),
        detail: `${notDispatched.toLocaleString("es-MX")} no despachados`,
      };
    })
    .filter((p): p is { week: string; value: number; detail: string } => p !== null);
  if (points.length === 0) return null;

  return { deptName: dept.name, points };
}
