import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageImprovementPlan } from "@/lib/guards";
import {
  createImprovementPlan,
  listAllImprovementPlansForAdmin,
  listImprovementPlansForCollaborator,
  listImprovementPlansForDept,
} from "@/lib/improvementPlan";

const commitmentSchema = z.object({
  indicador: z.string().trim().min(1, "Falta el indicador."),
  meta: z.string().trim().min(1, "Falta la meta."),
  responsable: z.enum(["COLABORADOR", "LIDER"]).default("COLABORADOR"),
});

const createSchema = z.object({
  collaboratorId: z.string().min(1, "Falta el colaborador."),
  situacion: z.string().trim().min(1, "Falta describir la situación."),
  resultadoEsperado: z.string().trim().min(1, "Falta el resultado esperado."),
  stageDurationDays: z.number().int().positive().max(120).optional(),
  commitments: z.array(commitmentSchema).min(1, "Agrega al menos un compromiso.").max(3, "Máximo 3 compromisos."),
});

// deptId nunca viene del cliente — se deriva del propio departamento del
// colaborador (igual que el comentario en weekly-checkin/route.ts) y se
// valida contra el equipo que el líder que hace la petición realmente
// lidera, para que nadie pueda abrirle un plan a alguien de otro equipo.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const collaborator = await prisma.user.findUnique({
    where: { id: parsed.data.collaboratorId },
    select: { id: true, deptId: true, isLeader: true },
  });
  if (!collaborator?.deptId) return NextResponse.json({ error: "Colaborador no encontrado." }, { status: 404 });

  if (!(await canManageImprovementPlan(collaborator.deptId))) {
    return NextResponse.json({ error: "No autorizado para abrir un plan en ese equipo." }, { status: 403 });
  }

  // Un líder nunca puede abrirle un plan a otro líder (ni a sí mismo) — el
  // desempeño de los líderes lo maneja el admin directamente, no entre
  // pares. No basta con ocultarlo en el listado del roster: se valida acá
  // también para que nadie lo dispare mandando el id directo.
  if (collaborator.isLeader && session.user.role !== "admin") {
    return NextResponse.json({ error: "Solo el admin puede abrir un Plan de Mejora a un líder." }, { status: 403 });
  }

  const existingActive = await prisma.improvementPlan.findFirst({
    where: { collaboratorId: collaborator.id, stage: { not: "CERRADO" } },
    select: { id: true },
  });
  if (existingActive) {
    return NextResponse.json({ error: "Este colaborador ya tiene un Plan de Mejora activo." }, { status: 409 });
  }

  const plan = await createImprovementPlan({
    collaboratorId: collaborator.id,
    deptId: collaborator.deptId,
    actorId: session.user.id,
    situacion: parsed.data.situacion,
    resultadoEsperado: parsed.data.resultadoEsperado,
    stageDurationDays: parsed.data.stageDurationDays,
    commitments: parsed.data.commitments,
  });

  return NextResponse.json(plan, { status: 201 });
}

// Admin ve todo company-wide (tablero global); un líder ve los planes de SU
// equipo; un colaborador sin ningún otro rol ve solo su(s) propio(s) plan(es).
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  if (session.user.role === "admin") {
    return NextResponse.json(await listAllImprovementPlansForAdmin());
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDeptId: true },
  });

  if (user?.isLeader && user.leadsDeptId) {
    return NextResponse.json(await listImprovementPlansForDept(user.leadsDeptId));
  }

  return NextResponse.json(await listImprovementPlansForCollaborator(session.user.id));
}
