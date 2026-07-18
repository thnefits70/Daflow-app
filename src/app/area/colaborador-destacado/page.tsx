import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { RecognitionPanel } from "@/components/recognition/RecognitionPanel";
import { currentMonth, MAX_TOTAL_SCORE } from "@/lib/recognition";

export default async function AreaRecognitionPage() {
  const session = await auth();
  if (!session?.user.id) redirect("/login");

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDeptId: true, leadsDept: { select: { name: true } } },
  });
  if (!me?.isLeader || !me.leadsDeptId) redirect("/area");

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
        Evalúa a cada persona de {me.leadsDept?.name ?? "tu equipo"} este mes — tu evaluación ayuda a reconocer el
        esfuerzo real de cada quien y a elegir al Colaborador Destacado del Mes.
      </div>
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
    </div>
  );
}
