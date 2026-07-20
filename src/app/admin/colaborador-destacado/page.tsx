import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { RecognitionPanel } from "@/components/recognition/RecognitionPanel";
import { RecognitionRanking } from "@/components/recognition/RecognitionRanking";
import { RecognitionTabs } from "@/components/recognition/RecognitionTabs";
import { currentMonth, MAX_TOTAL_SCORE } from "@/lib/recognition";

export default async function AdminRecognitionPage() {
  const month = currentMonth();

  const [leaders, departments] = await Promise.all([
    prisma.user.findMany({
      where: { isLeader: true, isActive: true },
      select: { id: true, name: true, photoUrl: true, position: true, department: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.department.findMany({ where: { isSpecial: false }, orderBy: { order: "asc" }, select: { id: true, name: true } }),
  ]);
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
        ]}
      />
    </div>
  );
}
