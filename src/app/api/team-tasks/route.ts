import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { createTeamTask, getAssignableMembers, getTeamTaskRole, listTeamTasks } from "@/lib/teamTasks";

// deptId por query: el admin lo manda al mirar un departamento puntual; el
// líder y el colaborador lo omiten y se usa su propia área.
async function resolveDeptId(req: NextRequest, bodyDeptId?: string | null): Promise<string | null> {
  const session = await auth();
  if (!session) return null;
  return bodyDeptId ?? req.nextUrl.searchParams.get("deptId") ?? session.user.deptId ?? null;
}

export async function GET(req: NextRequest) {
  const deptId = await resolveDeptId(req);
  if (!deptId) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const viewer = await getTeamTaskRole(deptId);
  if (!viewer) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const [tasks, members] = await Promise.all([
    listTeamTasks(deptId, viewer.role, viewer.userId),
    viewer.role === "leader" ? getAssignableMembers(deptId, viewer.userId) : Promise.resolve([]),
  ]);
  return NextResponse.json({ role: viewer.role, tasks, members });
}

const createSchema = z.object({
  title: z.string().trim().min(1, "Escribe qué hay que hacer.").max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Elige la fecha límite."),
  urgent: z.boolean().default(false),
  attachmentUrl: z.string().url().optional().nullable(),
  attachmentName: z.string().max(300).optional().nullable(),
  assigneeIds: z.array(z.string().min(1)).min(1, "Elige al menos una persona.").max(50),
});

// Solo el líder de esa área crea tareas (el admin solo consulta).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const deptId = await resolveDeptId(req);
  if (!deptId) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const viewer = await getTeamTaskRole(deptId);
  if (viewer?.role !== "leader") return NextResponse.json({ error: "Solo el líder del área puede asignar tareas." }, { status: 403 });

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  try {
    const task = await createTeamTask({
      deptId,
      leaderId: viewer.userId,
      title: parsed.data.title,
      description: parsed.data.description?.trim() || null,
      dueDate: parsed.data.dueDate,
      urgent: parsed.data.urgent,
      attachmentUrl: parsed.data.attachmentUrl ?? null,
      attachmentName: parsed.data.attachmentName ?? null,
      assigneeIds: parsed.data.assigneeIds,
    });
    return NextResponse.json(task, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo crear la tarea." }, { status: 400 });
  }
}
