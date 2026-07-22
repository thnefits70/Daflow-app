import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireAdminSession } from "@/lib/guards";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const deptId = req.nextUrl.searchParams.get("deptId");
  if (!deptId) return NextResponse.json({ error: "Falta deptId." }, { status: 400 });

  // Employees may only list processes of their own department.
  if (session.user.role === "employee" && session.user.deptId !== deptId) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const processes = await prisma.process.findMany({
    where: { deptId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { flowSteps: true } } },
  });

  return NextResponse.json(
    processes.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      stepCount: p._count.flowSteps,
    }))
  );
}

const createSchema = z.object({
  deptId: z.string().min(1),
  title: z.string().trim().min(1, "El título es obligatorio."),
});

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const process = await prisma.process.create({
    data: {
      deptId: parsed.data.deptId,
      title: parsed.data.title,
      description: "Describe en qué consiste este proceso.",
    },
  });

  return NextResponse.json(process, { status: 201 });
}
