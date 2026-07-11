import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ProfileDetail } from "@/components/nomina/ProfileDetail";

export default async function NominaProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;

  const [user, departments, positions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: {
        milestones: { orderBy: { date: "desc" } },
        examScores: { orderBy: { createdAt: "desc" }, include: { exam: { select: { title: true } } } },
      },
    }),
    prisma.department.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true, code: true } }),
    prisma.position.findMany({ orderBy: { name: "asc" } }),
  ]);

  if (!user) notFound();

  return (
    <ProfileDetail
      profile={{
        id: user.id,
        name: user.name,
        username: user.username,
        deptId: user.deptId,
        position: user.position,
        photoUrl: user.photoUrl,
        email: user.email,
        phone: user.phone,
        startDate: user.startDate ? user.startDate.toISOString() : null,
        skills: user.skills,
        cvUrl: user.cvUrl,
        cvName: user.cvName,
        isLeader: user.isLeader,
        leadsDeptId: user.leadsDeptId,
        milestones: user.milestones.map((m) => ({
          id: m.id,
          title: m.title,
          note: m.note,
          date: m.date.toISOString(),
        })),
        examScores: user.examScores.map((e) => ({
          id: e.id,
          score: e.score,
          total: e.total,
          createdAt: e.createdAt.toISOString(),
          exam: { title: e.exam.title },
        })),
      }}
      departments={departments}
      positions={positions.map((p) => ({ id: p.id, deptId: p.deptId, name: p.name }))}
    />
  );
}
