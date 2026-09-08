import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Lista de líderes que un no-líder puede elegir para dejarles una
// observación externa — todos menos el de su propia área (a ese lo califica
// directo en "Calificar a mi líder", ver leader-feedback/route.ts).
export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== "employee") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isLeader: true, deptId: true } });
  if (!me || me.isLeader) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const leaders = await prisma.user.findMany({
    where: { isLeader: true, isActive: true, leadsDeptId: { not: me.deptId ?? undefined } },
    select: { id: true, name: true, photoUrl: true, leadsDept: { select: { name: true } } },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    leaders: leaders.map((l) => ({ id: l.id, name: l.name, photoUrl: l.photoUrl, deptName: l.leadsDept?.name ?? null })),
  });
}
