import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { RecognitionPanel } from "@/components/recognition/RecognitionPanel";
import { RecognitionRanking } from "@/components/recognition/RecognitionRanking";
import { RecognitionMyProgress } from "@/components/recognition/RecognitionMyProgress";
import { RecognitionTabs } from "@/components/recognition/RecognitionTabs";
import { currentMonth, MAX_TOTAL_SCORE } from "@/lib/recognition";

export default async function AreaRecognitionPage() {
  const session = await auth();
  if (!session?.user.id) redirect("/login");

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDeptId: true, leadsDept: { select: { name: true } } },
  });

  // A regular employee (not a leader) doesn't evaluate anyone — they only
  // see their own progress, no tabs needed.
  if (!me?.isLeader || !me.leadsDeptId) {
    return (
      <div>
        <TopLine eyebrow="Reconocimiento" title="Colaborador Destacado del Mes" />
        <div className="text-[13px] text-steel mb-5 max-w-2xl">
          Aquí puedes ver tu propio progreso mes a mes, según la evaluación de tu líder.
        </div>
        <RecognitionMyProgress />
      </div>
    );
  }

  const month = currentMonth();
  const team = await prisma.user.findMany({
    where: { deptId: me.leadsDeptId, isLeader: false },
    select: { id: true, name: true, photoUrl: true, position: true, department: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const evaluations = await prisma.monthlyEvaluation.findMany({
    where: { month, evaluateeId: { in: team.map((u) => u.id) } },
    select: { evaluateeId: true },
  });
  const doneIds = new Set(evaluations.map((e) => e.evaluateeId));

  return (
    <div>
      <TopLine eyebrow="Reconocimiento" title="Colaborador Destacado del Mes" />
      <div className="text-[13px] text-steel mb-5 max-w-2xl">
        Evalúa a cada persona de {me.leadsDept?.name ?? "tu equipo"} este mes, revisa el ranking de tu equipo, y
        consulta tu propio progreso como líder (a ti te evalúa el admin).
      </div>
      <RecognitionTabs
        tabs={[
          {
            key: "evaluar",
            label: "Evaluar a mi equipo",
            content: (
              <RecognitionPanel
                month={month}
                maxTotalScore={MAX_TOTAL_SCORE}
                people={team.map((u) => ({
                  id: u.id,
                  name: u.name,
                  photoUrl: u.photoUrl,
                  position: u.position,
                  deptName: u.department?.name ?? null,
                  done: doneIds.has(u.id),
                }))}
                emptyMessage="Aún no tienes personas asignadas a tu equipo."
              />
            ),
          },
          {
            key: "ranking",
            label: "Ranking de mi equipo",
            content: <RecognitionRanking scope="leader" />,
          },
          {
            key: "progreso",
            label: "Mi progreso",
            content: <RecognitionMyProgress />,
          },
        ]}
      />
    </div>
  );
}
