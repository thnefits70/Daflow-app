import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { RecognitionPanel } from "@/components/recognition/RecognitionPanel";
import { RecognitionRanking } from "@/components/recognition/RecognitionRanking";
import { RecognitionTabs } from "@/components/recognition/RecognitionTabs";
import { AdminLeadershipDashboard } from "@/components/recognition/AdminLeadershipDashboard";
import { currentMonth, MAX_TOTAL_SCORE } from "@/lib/recognition";
import { FORMER_LEADERS } from "@/lib/formerLeaders";
import { formatMonthLabel } from "@/lib/pendingTasks";

export default async function AdminRecognitionPage() {
  const month = currentMonth();

  const [currentLeaders, departments, formerLeaderUsers, formerLeaderDone] = await Promise.all([
    prisma.user.findMany({
      where: { isLeader: true, isActive: true },
      select: { id: true, name: true, photoUrl: true, position: true, department: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.department.findMany({ where: { isSpecial: false, deletedAt: null }, orderBy: { order: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({
      where: { id: { in: FORMER_LEADERS.map((f) => f.userId) }, isActive: true },
      select: { id: true, name: true, photoUrl: true, position: true, department: { select: { name: true } } },
    }),
    prisma.monthlyEvaluation.findMany({
      where: { OR: FORMER_LEADERS.map((f) => ({ evaluateeId: f.userId, month: f.lastLeaderMonth })) },
      select: { evaluateeId: true },
    }),
  ]);
  // Pedido del usuario 2026-10-01: un ex líder (formerLeaders.ts) sigue acá
  // solo hasta que el admin lo califica por su último mes como líder; después
  // desaparece y lo califica el líder de su área.
  const pendingFormer = formerLeaderUsers
    .filter((u) => !formerLeaderDone.some((d) => d.evaluateeId === u.id))
    .map((u) => {
      const lastMonth = FORMER_LEADERS.find((f) => f.userId === u.id)!.lastLeaderMonth;
      return { ...u, position: `Solo ${formatMonthLabel(lastMonth)} (ese mes era líder)`, onlyMonth: lastMonth };
    });
  const leaders: ((typeof currentLeaders)[number] & { onlyMonth?: string })[] = [...currentLeaders, ...pendingFormer];
  // Every month each leader has an evaluation for (not just the current
  // one) — needed so the "Evaluado ese mes" badge stays correct when the
  // month picker is used to catch up a past month.
  const evaluations = await prisma.monthlyEvaluation.findMany({
    where: { evaluateeId: { in: leaders.map((u) => u.id) } },
    select: { evaluateeId: true, month: true },
  });
  const doneMonthsByUser = new Map<string, string[]>();
  for (const e of evaluations) {
    if (!doneMonthsByUser.has(e.evaluateeId)) doneMonthsByUser.set(e.evaluateeId, []);
    doneMonthsByUser.get(e.evaluateeId)!.push(e.month);
  }

  return (
    <div>
      <TopLine eyebrow="Reconocimiento" title="Colaborador Destacado del Mes" />
      <div className="text-[13px] text-steel mb-5 max-w-2xl">
        Evalúa a cada líder de área este mes. Los líderes, por su parte, evalúan a su propio equipo — en Ranking
        puedes ver a todos, de cualquier área, con el detalle completo de cada evaluación.
      </div>
      <RecognitionTabs
        tabs={[
          {
            key: "evaluar",
            label: "Evaluar líderes",
            content: (
              <RecognitionPanel
                month={month}
                maxTotalScore={MAX_TOTAL_SCORE}
                allowMonthPicker
                people={leaders.map((u) => ({
                  id: u.id,
                  name: u.name,
                  photoUrl: u.photoUrl,
                  position: u.position,
                  deptName: u.department?.name ?? null,
                  doneMonths: doneMonthsByUser.get(u.id) ?? [],
                  onlyMonth: u.onlyMonth,
                }))}
                emptyMessage="No hay líderes registrados todavía."
              />
            ),
          },
          {
            key: "ranking",
            label: "Ranking general",
            content: <RecognitionRanking scope="admin" departments={departments} />,
          },
          {
            key: "mi-liderazgo",
            label: "Mi liderazgo",
            content: <AdminLeadershipDashboard />,
          },
        ]}
      />
    </div>
  );
}
