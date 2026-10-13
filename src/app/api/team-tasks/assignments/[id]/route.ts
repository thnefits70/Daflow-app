import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  approveAssignment,
  cancelAssignment,
  completeAssignment,
  getAssignmentForAction,
  getTeamTaskRole,
  returnAssignment,
  startAssignment,
} from "@/lib/teamTasks";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({
    action: z.literal("done"),
    comment: z.string().trim().min(1, "Escribe qué hiciste.").max(4000),
    photoUrl: z.string().url().optional().nullable(),
  }),
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("return"), comment: z.string().trim().min(1, "Escribe qué falta.").max(4000) }),
  z.object({ action: z.literal("cancel") }),
]);

// Empezar y marcar hecha: solo la persona asignada. Aprobar, devolver y
// cancelar: solo el líder del área de la tarea. El admin no actúa aquí.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const a = await getAssignmentForAction(id);
  if (!a) return NextResponse.json({ error: "Tarea no encontrada." }, { status: 404 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const viewer = await getTeamTaskRole(a.task.deptId);
  const isAssignee = session.user.id === a.assigneeId;
  const isLeader = viewer?.role === "leader";

  try {
    const d = parsed.data;
    if (d.action === "start" || d.action === "done") {
      if (!isAssignee) return NextResponse.json({ error: "Esta tarea no es tuya." }, { status: 403 });
      if (d.action === "start") await startAssignment(a, session.user.id);
      else await completeAssignment(a, session.user.id, d.comment, d.photoUrl ?? null);
    } else {
      if (!isLeader) return NextResponse.json({ error: "Solo el líder del área puede hacer esto." }, { status: 403 });
      if (d.action === "approve") await approveAssignment(a, session.user.id);
      else if (d.action === "return") await returnAssignment(a, session.user.id, d.comment);
      else await cancelAssignment(a, session.user.id);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo guardar." }, { status: 400 });
  }
}
