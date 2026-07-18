import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { RecognitionPanel } from "@/components/recognition/RecognitionPanel";
import { currentMonth, MAX_TOTAL_SCORE } from "@/lib/recognition";

export default async function AdminRecognitionPage() {
  const month = currentMonth();

  const leaders = await prisma.user.findMany({
    where: { isLeader: true },
    select: { id: true, name: true, photoUrl: true, position: true, department: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const evaluations = await prisma.monthlyEvaluation.findMany({
    where: { month, evaluateeId: { in: leaders.map((u) => u.id) } },
    select: { evaluateeId: true },
  });
  const doneIds = new Set(evaluations.map((e) => e.evaluateeId));

  return (
    <div>
      <TopLine eyebrow="Reconocimiento" title="Colaborador Destacado del Mes" />
      <div className="text-[13px] text-steel mb-5 max-w-2xl">
        Evalúa a cada líder de área este mes. Los líderes, por su parte, evalúan a su propio equipo — tú puedes ver
        el detalle completo de todas las evaluaciones en la sección de Ranking.
      </div>
      <RecognitionPanel
        month={month}
        maxTotalScore={MAX_TOTAL_SCORE}
        people={leaders.map((u) => ({
          id: u.id,
          name: u.name,
          photoUrl: u.photoUrl,
          position: u.position,
          deptName: u.department?.name ?? null,
          done: doneIds.has(u.id),
        }))}
        emptyMessage="No hay líderes registrados todavía."
      />
    </div>
  );
}
