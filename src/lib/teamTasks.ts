import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { dbUserId } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { sendPushToOwner } from "@/lib/webPush";
import type { Prisma, TeamTaskEventKind, TeamTaskStatus } from "@/generated/prisma/client";

// Tareas del equipo — pedido de Bryan Ríos 2026-10-13, para todos los
// líderes. El líder asigna una tarea a una o varias personas de SU área; cada
// una la avanza por su lado (Por hacer → En proceso → Hecha) y el líder la
// aprueba o la devuelve con un comentario. Al marcarla "Hecha" el
// colaborador tiene que escribir qué hizo (foto opcional). El admin solo
// consulta: no crea, no aprueba y no recibe avisos.

export const TEAM_TASK_HREF = "/area/workspace?tab=tareas";
export const OPEN_STATUSES: TeamTaskStatus[] = ["POR_HACER", "EN_PROCESO", "DEVUELTA"];

// Ecuador no tiene horario de verano: siempre UTC-5.
const EC_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export function ecuadorDay(d: Date = new Date()): string {
  return new Date(d.getTime() - EC_OFFSET_MS).toISOString().slice(0, 10);
}
function dueDayOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function isAssignmentOverdue(status: TeamTaskStatus, dueDate: Date, today = ecuadorDay()): boolean {
  return OPEN_STATUSES.includes(status) && today > dueDayOf(dueDate);
}

export type TeamTaskRole = "leader" | "member" | "admin";

// Quién está mirando las tareas de ESTE departamento. Un líder solo gestiona
// las de su propia área; el resto del área solo ve las que le asignaron.
export async function getTeamTaskRole(deptId: string): Promise<{ role: TeamTaskRole; userId: string } | null> {
  const session = await auth();
  if (!session) return null;
  if (session.user.role === "admin") return { role: "admin", userId: "admin" };
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isActive: true, isLeader: true, leadsDeptId: true, deptId: true },
  });
  if (!me?.isActive) return null;
  if (me.isLeader && me.leadsDeptId === deptId) return { role: "leader", userId: session.user.id };
  if (me.deptId === deptId) return { role: "member", userId: session.user.id };
  return null;
}

const ASSIGNMENT_INCLUDE = {
  assignee: { select: { id: true, name: true } },
  reviewedBy: { select: { name: true } },
  events: { orderBy: { createdAt: "asc" as const }, include: { actor: { select: { name: true } } } },
};
const TASK_INCLUDE = {
  createdBy: { select: { name: true } },
  assignments: { include: ASSIGNMENT_INCLUDE, orderBy: { createdAt: "asc" as const } },
};
type TaskRow = Prisma.TeamTaskGetPayload<{ include: typeof TASK_INCLUDE }>;

export type TeamTaskEventDTO = {
  kind: TeamTaskEventKind;
  comment: string | null;
  photoUrl: string | null;
  actorName: string | null;
  createdAt: string;
};

export type TeamTaskAssignmentDTO = {
  id: string;
  assigneeId: string;
  assigneeName: string;
  status: TeamTaskStatus;
  overdue: boolean;
  startedAt: string | null;
  doneAt: string | null;
  doneComment: string | null;
  donePhotoUrl: string | null;
  returnedAt: string | null;
  returnComment: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  events: TeamTaskEventDTO[];
};

export type TeamTaskDTO = {
  id: string;
  title: string;
  description: string | null;
  dueDate: string;
  urgent: boolean;
  attachmentUrl: string | null;
  attachmentName: string | null;
  createdByName: string | null;
  createdAt: string;
  assignments: TeamTaskAssignmentDTO[];
};

function mapTask(t: TaskRow, onlyAssigneeId?: string): TeamTaskDTO {
  const today = ecuadorDay();
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    dueDate: dueDayOf(t.dueDate),
    urgent: t.urgent,
    attachmentUrl: t.attachmentUrl,
    attachmentName: t.attachmentName,
    createdByName: t.createdBy?.name ?? null,
    createdAt: t.createdAt.toISOString(),
    assignments: t.assignments
      .filter((a) => !onlyAssigneeId || a.assigneeId === onlyAssigneeId)
      .map((a) => ({
        id: a.id,
        assigneeId: a.assigneeId,
        assigneeName: a.assignee.name,
        status: a.status,
        overdue: isAssignmentOverdue(a.status, t.dueDate, today),
        startedAt: a.startedAt?.toISOString() ?? null,
        doneAt: a.doneAt?.toISOString() ?? null,
        doneComment: a.doneComment,
        donePhotoUrl: a.donePhotoUrl,
        returnedAt: a.returnedAt?.toISOString() ?? null,
        returnComment: a.returnComment,
        reviewedAt: a.reviewedAt?.toISOString() ?? null,
        reviewedByName: a.reviewedBy?.name ?? null,
        events: a.events.map((e) => ({
          kind: e.kind,
          comment: e.comment,
          photoUrl: e.photoUrl,
          actorName: e.actor?.name ?? null,
          createdAt: e.createdAt.toISOString(),
        })),
      })),
  };
}

// Líder y admin: todas las del área. Colaborador: solo las suyas, y de cada
// tarea solo su propia parte (no ve cómo van sus compañeros).
export async function listTeamTasks(deptId: string, role: TeamTaskRole, userId: string): Promise<TeamTaskDTO[]> {
  const where: Prisma.TeamTaskWhereInput = role === "member" ? { deptId, assignments: { some: { assigneeId: userId } } } : { deptId };
  const tasks = await prisma.teamTask.findMany({ where, include: TASK_INCLUDE, orderBy: { createdAt: "desc" }, take: 300 });
  return tasks.map((t) => mapTask(t, role === "member" ? userId : undefined));
}

// A quién puede asignarle el líder: gente activa de su área, menos él mismo.
export async function getAssignableMembers(deptId: string, leaderId: string): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({
    where: { deptId, isActive: true, id: { not: leaderId } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

async function getDeptLeaderIds(deptId: string): Promise<string[]> {
  const leaders = await prisma.user.findMany({ where: { isLeader: true, leadsDeptId: deptId, isActive: true }, select: { id: true } });
  return leaders.map((l) => l.id);
}

function formatDue(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

export async function createTeamTask(params: {
  deptId: string;
  leaderId: string;
  title: string;
  description: string | null;
  dueDate: string;
  urgent: boolean;
  attachmentUrl: string | null;
  attachmentName: string | null;
  assigneeIds: string[];
}): Promise<TeamTaskDTO> {
  const ids = [...new Set(params.assigneeIds)];
  const allowed = new Set((await getAssignableMembers(params.deptId, params.leaderId)).map((m) => m.id));
  if (ids.length === 0) throw new Error("Elige al menos una persona.");
  if (ids.some((id) => !allowed.has(id))) throw new Error("Solo puedes asignar tareas a personas activas de tu área.");

  const task = await prisma.teamTask.create({
    data: {
      deptId: params.deptId,
      createdById: dbUserId(params.leaderId),
      title: params.title,
      description: params.description,
      dueDate: new Date(`${params.dueDate}T00:00:00.000Z`),
      urgent: params.urgent,
      attachmentUrl: params.attachmentUrl,
      attachmentName: params.attachmentName,
      assignments: {
        create: ids.map((assigneeId) => ({
          assigneeId,
          events: { create: { kind: "CREADA" as const, actorId: dbUserId(params.leaderId) } },
        })),
      },
    },
    include: TASK_INCLUDE,
  });

  for (const id of ids) {
    await notifyOwner(id, {
      title: params.urgent ? "🔴 Tarea urgente de tu líder" : "Nueva tarea de tu líder",
      body: `${params.title} — para el ${formatDue(params.dueDate)}.`,
      url: TEAM_TASK_HREF,
    }).catch(() => null);
  }
  return mapTask(task);
}

type AssignmentForAction = Prisma.TeamTaskAssignmentGetPayload<{
  include: { task: { select: { id: true; deptId: true; title: true } }; assignee: { select: { name: true } } };
}>;

export async function getAssignmentForAction(assignmentId: string): Promise<AssignmentForAction | null> {
  return prisma.teamTaskAssignment.findUnique({
    where: { id: assignmentId },
    include: { task: { select: { id: true, deptId: true, title: true } }, assignee: { select: { name: true } } },
  });
}

async function setStatus(
  a: AssignmentForAction,
  actorId: string,
  kind: TeamTaskEventKind,
  data: Prisma.TeamTaskAssignmentUpdateInput,
  event: { comment?: string | null; photoUrl?: string | null } = {},
) {
  await prisma.teamTaskAssignment.update({
    where: { id: a.id },
    data: {
      ...data,
      events: { create: { kind, comment: event.comment ?? null, photoUrl: event.photoUrl ?? null, actorId: dbUserId(actorId) } },
    },
  });
}

export async function startAssignment(a: AssignmentForAction, actorId: string) {
  if (a.status !== "POR_HACER" && a.status !== "DEVUELTA") throw new Error("Esta tarea ya está en proceso o terminada.");
  await setStatus(a, actorId, "EMPEZADA", { status: "EN_PROCESO", startedAt: a.startedAt ?? new Date() });
}

export async function completeAssignment(a: AssignmentForAction, actorId: string, comment: string, photoUrl: string | null) {
  if (!OPEN_STATUSES.includes(a.status)) throw new Error("Esta tarea ya fue marcada como hecha.");
  const now = new Date();
  await setStatus(
    a,
    actorId,
    "HECHA",
    { status: "HECHA", startedAt: a.startedAt ?? now, doneAt: now, doneComment: comment, donePhotoUrl: photoUrl },
    { comment, photoUrl },
  );
  for (const leaderId of await getDeptLeaderIds(a.task.deptId)) {
    await notifyOwner(leaderId, {
      title: "Tarea terminada — revísala",
      body: `${a.assignee.name} terminó "${a.task.title}": ${comment}`,
      url: TEAM_TASK_HREF,
    }).catch(() => null);
  }
}

export async function approveAssignment(a: AssignmentForAction, actorId: string) {
  if (a.status !== "HECHA") throw new Error("Solo se aprueba una tarea marcada como hecha.");
  await setStatus(a, actorId, "APROBADA", { status: "APROBADA", reviewedAt: new Date(), reviewedBy: { connect: { id: actorId } } });
  await notifyOwner(a.assigneeId, {
    title: "✅ Tu líder aprobó tu tarea",
    body: a.task.title,
    url: TEAM_TASK_HREF,
  }).catch(() => null);
}

export async function returnAssignment(a: AssignmentForAction, actorId: string, comment: string) {
  if (a.status !== "HECHA") throw new Error("Solo se devuelve una tarea marcada como hecha.");
  await setStatus(
    a,
    actorId,
    "DEVUELTA",
    { status: "DEVUELTA", returnedAt: new Date(), returnComment: comment, reviewedAt: new Date(), reviewedBy: { connect: { id: actorId } } },
    { comment },
  );
  await notifyOwner(a.assigneeId, {
    title: "↩️ Tu líder te devolvió una tarea",
    body: `${a.task.title} — ${comment}`,
    url: TEAM_TASK_HREF,
  }).catch(() => null);
}

export async function cancelAssignment(a: AssignmentForAction, actorId: string) {
  if (a.status === "APROBADA" || a.status === "CANCELADA") throw new Error("Esta tarea ya está cerrada.");
  await setStatus(a, actorId, "CANCELADA", { status: "CANCELADA" });
  await notifyOwner(a.assigneeId, {
    title: "Tu líder canceló una tarea",
    body: `${a.task.title} — ya no hace falta hacerla.`,
    url: TEAM_TASK_HREF,
  }).catch(() => null);
}

// ---------------- Pendientes de Inicio ----------------

// Colaborador: lo que le falta hacer (incluye lo devuelto). Una sola consulta.
export async function getMyTeamTaskSummary(userId: string) {
  const rows = await prisma.teamTaskAssignment.findMany({
    where: { assigneeId: userId, status: { in: OPEN_STATUSES } },
    select: { status: true, task: { select: { title: true, dueDate: true } } },
  });
  const today = ecuadorDay();
  const tomorrow = ecuadorDay(new Date(Date.now() + DAY_MS));
  const overdue = rows.filter((r) => today > dueDayOf(r.task.dueDate));
  const dueTomorrow = rows.filter((r) => dueDayOf(r.task.dueDate) === tomorrow);
  const returned = rows.filter((r) => r.status === "DEVUELTA");
  return { total: rows.length, overdue, dueTomorrow, returned, rows };
}

export async function getMyTeamTaskPendingItem(userId: string) {
  const s = await getMyTeamTaskSummary(userId);
  if (s.total === 0) return null;
  const parts = [`${s.total} por hacer`];
  if (s.overdue.length) parts.push(`${s.overdue.length} vencida${s.overdue.length === 1 ? "" : "s"}`);
  if (s.returned.length) parts.push(`${s.returned.length} devuelta${s.returned.length === 1 ? "" : "s"}`);
  if (s.dueTomorrow.length) parts.push(`${s.dueTomorrow.length} vence${s.dueTomorrow.length === 1 ? "" : "n"} mañana`);
  return {
    type: "tareas_asignadas",
    icon: "📝",
    label: "Tareas asignadas por tu líder",
    meta: parts.join(" · "),
    overdue: s.overdue.length > 0 || s.returned.length > 0,
    href: TEAM_TASK_HREF,
  };
}

// Líder: lo terminado que espera su revisión y lo vencido de su equipo.
export async function getLeaderTeamTaskPendingItems(deptId: string, href: string = TEAM_TASK_HREF) {
  const rows = await prisma.teamTaskAssignment.findMany({
    where: {
      task: { deptId },
      status: { in: ["HECHA", ...OPEN_STATUSES] },
      assignee: { isActive: true, deptId },
    },
    select: { status: true, assignee: { select: { name: true } }, task: { select: { dueDate: true } } },
  });
  const today = ecuadorDay();
  const toReview = rows.filter((r) => r.status === "HECHA");
  const overdue = rows.filter((r) => isAssignmentOverdue(r.status, r.task.dueDate, today));
  const names = (list: typeof rows) => [...new Set(list.map((r) => r.assignee.name))].join(", ");
  const items = [];
  if (toReview.length) {
    items.push({
      type: "tareas_por_revisar",
      icon: "✅",
      label: `Tareas terminadas por revisar (${toReview.length})`,
      meta: names(toReview),
      overdue: false,
      href,
    });
  }
  if (overdue.length) {
    items.push({
      type: "tareas_vencidas_equipo",
      icon: "⏰",
      label: `Tareas de tu equipo vencidas (${overdue.length})`,
      meta: names(overdue),
      overdue: true,
      href,
    });
  }
  return items;
}

// ---------------- Avisos diarios (cron de las 8:00) ----------------

// 1) A cada colaborador con tareas abiertas, un solo aviso del día: lo
//    vencido, lo que vence mañana o cuántas tiene.
// 2) Al líder, una sola vez por tarea, cuando a alguien se le pasa la fecha.
export async function sendTeamTaskDailyNotices(): Promise<number> {
  let sent = 0;
  const today = ecuadorDay();
  const tomorrow = ecuadorDay(new Date(Date.now() + DAY_MS));
  const open = await prisma.teamTaskAssignment.findMany({
    where: { status: { in: OPEN_STATUSES }, assignee: { isActive: true } },
    select: {
      id: true,
      assigneeId: true,
      overdueNotifiedAt: true,
      assignee: { select: { name: true, deptId: true } },
      task: { select: { title: true, dueDate: true, deptId: true } },
    },
  });

  const byPerson = new Map<string, typeof open>();
  for (const a of open) byPerson.set(a.assigneeId, [...(byPerson.get(a.assigneeId) ?? []), a]);
  for (const [ownerId, list] of byPerson) {
    const overdue = list.filter((a) => today > dueDayOf(a.task.dueDate));
    const dueTomorrow = list.filter((a) => dueDayOf(a.task.dueDate) === tomorrow);
    const body = overdue.length
      ? `Vencida: "${overdue[0].task.title}"${overdue.length > 1 ? ` (+${overdue.length - 1} más)` : ""}. Tienes ${list.length} por hacer.`
      : dueTomorrow.length
        ? `Vence mañana: "${dueTomorrow[0].task.title}"${dueTomorrow.length > 1 ? ` (+${dueTomorrow.length - 1} más)` : ""}. Tienes ${list.length} por hacer.`
        : `Tienes ${list.length} tarea${list.length === 1 ? "" : "s"} por hacer.`;
    await sendPushToOwner(ownerId, { title: "DAFLOW · Tus tareas", body, url: TEAM_TASK_HREF }).catch(() => null);
    sent++;
  }

  const newlyOverdue = open.filter((a) => !a.overdueNotifiedAt && today > dueDayOf(a.task.dueDate) && a.assignee.deptId === a.task.deptId);
  const leadersByDept = new Map<string, string[]>();
  for (const a of newlyOverdue) {
    if (!leadersByDept.has(a.task.deptId)) leadersByDept.set(a.task.deptId, await getDeptLeaderIds(a.task.deptId));
    for (const leaderId of leadersByDept.get(a.task.deptId)!) {
      await notifyOwner(leaderId, {
        title: "⏰ Tarea vencida en tu equipo",
        body: `${a.assignee.name} no terminó "${a.task.title}" a tiempo.`,
        url: TEAM_TASK_HREF,
      }).catch(() => null);
      sent++;
    }
    await prisma.teamTaskAssignment.update({ where: { id: a.id }, data: { overdueNotifiedAt: new Date() } });
  }
  return sent;
}
