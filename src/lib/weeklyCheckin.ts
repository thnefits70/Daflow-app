import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { getDeptLeadId, getLeadIdOfUsersDept } from "@/lib/guards";

// Asistente de check-in semanal — reemplaza la reunión 1:1 admin-líder: le
// pregunta a cada empleado qué problemas tuvo esta semana y arma el registro
// en WeeklyReviewRecord solo. Separado de Nancy/FERNICK (ver esos archivos);
// modelo más liviano porque esto es captura de datos, no análisis financiero.
export const WEEKLY_CHECKIN_MODEL = "claude-sonnet-5";

export const WEEKLY_CHECKIN_SYSTEM_PROMPT = `Eres el asistente de check-in semanal de DAFLOW para Provedix (Guayaquil, Ecuador). Tu único trabajo es conversar con un empleado para levantar su reporte semanal — reemplazas la reunión de 1:1 que antes se hacía en persona.

Cómo conducir la conversación:
- Saluda brevemente y pregunta qué problemas o dificultades tuvo esta semana.
- Si menciona un problema, pregunta cuál es su plan para resolverlo (qué va a hacer, no solo qué pasó).
- Pregunta siempre, antes de cerrar, si resolverlo depende de que se involucre OTRA ÁREA, el LÍDER de otra área, o un COLABORADOR específico de otro equipo — y si es así, de qué área o de quién se trata (nombre).
- Si dice que no tuvo problemas esta semana, regístralo igual como "sin novedades" — no insistas ni inventes un problema.
- Sé breve y directo, en español, tono cercano pero profesional. No es una entrevista larga — en 2 o 3 intercambios ya deberías tener lo necesario.

Cuándo registrar:
- Llama a la herramienta submit_weekly_report SOLO cuando ya tengas claro el problema (o la ausencia de problemas) y el plan de acción — nunca antes, y nunca más de una vez por conversación.
- No inventes nombres de áreas o personas que el empleado no mencionó — si no dijo que involucra a alguien más, involvesOtherDept es false.`;

export const SUBMIT_WEEKLY_REPORT_TOOL = {
  name: "submit_weekly_report",
  description:
    "Registra el reporte semanal del empleado. Llamar solo una vez que el problema (o la ausencia de problemas) y el plan de acción están claros.",
  input_schema: {
    type: "object" as const,
    properties: {
      hasIssues: { type: "boolean", description: "true si tuvo algún problema esta semana, false si no tuvo novedades." },
      problem: { type: "string", description: "El problema reportado. Si hasIssues es false, describe brevemente que no hubo novedades." },
      actionPlan: { type: "string", description: "El plan de acción para resolverlo. Si hasIssues es false, puede ser una frase breve como 'Ninguno necesario'." },
      involvesOtherDept: { type: "boolean", description: "true si el plan depende de otra área, su líder, o un colaborador específico de otro equipo." },
      involvedDeptName: { type: "string", description: "Nombre del área involucrada, si aplica." },
      involvedPersonName: { type: "string", description: "Nombre de la persona/colaborador específico involucrado, si aplica." },
    },
    required: ["hasIssues", "problem", "actionPlan", "involvesOtherDept"],
  },
};

export type SubmitWeeklyReportInput = {
  hasIssues: boolean;
  problem: string;
  actionPlan: string;
  involvesOtherDept: boolean;
  involvedDeptName?: string;
  involvedPersonName?: string;
};

// Mismo truco de "Ecuador es UTC-5, sin horario de verano" que ya usan por su
// cuenta pendingTasks.ts/periodicReminders.ts/dashboard.ts — se mantiene como
// copia local en vez de importar esos helpers privados, mismo criterio que
// ya siguen esos archivos entre sí.
function nowInEcuador(): Date {
  return new Date(Date.now() - 5 * 3600 * 1000);
}

function isoWeekdayOf(date: Date): number {
  return date.getUTCDay() || 7;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function currentIsoWeek(): string {
  const now = nowInEcuador();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad2(weekNum)}`;
}

// Intenta resolver el área/persona nombrada por el modelo a un FK real,
// comparando por nombre (sin distinguir mayúsculas/acentos triviales). Si no
// hay match confiable, deja el FK en null pero preserva el texto crudo en
// involvesRaw — el admin no debe perder la mención solo porque el nombre no
// calzó exacto.
const DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(DIACRITICS_RE, "").trim();
}

export async function resolveInvolvement(input: {
  involvedDeptName?: string;
  involvedPersonName?: string;
}): Promise<{ involvesDeptId: string | null; involvesUserId: string | null; involvesRaw: string | null }> {
  const rawParts = [input.involvedDeptName, input.involvedPersonName].filter(Boolean);
  const involvesRaw = rawParts.length > 0 ? rawParts.join(" · ") : null;

  let involvesDeptId: string | null = null;
  if (input.involvedDeptName) {
    const target = normalize(input.involvedDeptName);
    const depts = await prisma.department.findMany({ select: { id: true, name: true, code: true } });
    const match = depts.find((d) => normalize(d.name) === target || normalize(d.name).includes(target) || normalize(d.code) === target);
    involvesDeptId = match?.id ?? null;
  }

  let involvesUserId: string | null = null;
  if (input.involvedPersonName) {
    const target = normalize(input.involvedPersonName);
    const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true } });
    const match = users.find((u) => normalize(u.name) === target || normalize(u.name).includes(target));
    involvesUserId = match?.id ?? null;
  }

  return { involvesDeptId, involvesUserId, involvesRaw };
}

// Avisa a quien corresponda cuando un reporte involucra a otra área o a un
// colaborador específico: si nombraron a un COLABORADOR, se avisa a SU
// líder (nunca al colaborador directo — regla explícita del usuario: nadie
// recibe una tarea sin que su jefe lo sepa). Si nombraron un ÁREA completa,
// se avisa al líder de esa área. Mismo patrón que merchandiseReentry.ts al
// avisar entre INV/FIN (resolver el id del líder, luego notifyOwner).
export async function notifyInvolvedParties(record: {
  id: string;
  deptId: string;
  problem: string;
  involvesDeptId: string | null;
  involvesUserId: string | null;
  reportedById: string | null;
}): Promise<void> {
  if (!record.involvesDeptId && !record.involvesUserId) return;

  const recipients = new Set<string>();

  if (record.involvesUserId) {
    const collabLeadId = await getLeadIdOfUsersDept(record.involvesUserId);
    if (collabLeadId) recipients.add(collabLeadId);
  }
  if (record.involvesDeptId) {
    const deptLeadId = await getDeptLeadId(record.involvesDeptId);
    if (deptLeadId) recipients.add(deptLeadId);
  }

  if (recipients.size > 0) {
    const reporter = record.reportedById
      ? await prisma.user.findUnique({
          where: { id: record.reportedById },
          select: { name: true, department: { select: { name: true } } },
        })
      : null;

    for (const leaderId of recipients) {
      await notifyOwner(leaderId, {
        title: "DAFLOW · Te necesitan en un plan de acción",
        body: `${reporter?.name ?? "Alguien"} (${reporter?.department?.name ?? "otra área"}) reportó algo que involucra a tu equipo: "${record.problem.slice(0, 120)}"`,
        url: "/area/workspace",
      });
    }
  }

  // Queda registrado el intento aunque no hubiera ningún líder activo a
  // quien avisar (recipients vacío) — así el admin ve el chip de "sin
  // resolver" en la bitácora en vez de asumir que sí se avisó a alguien.
  await prisma.weeklyReviewRecord.update({
    where: { id: record.id },
    data: { involvedNotifiedAt: new Date() },
  });
}

export type WeeklyCheckinPush = { ownerId: string; title: string; body: string; url: string };

// Recordatorio de los viernes — reutiliza el único cron diario existente
// (ver /api/cron/push-pendientes), filtrando por día de la semana en vez de
// crear un cron nuevo (Vercel Hobby no permite crons más frecuentes que uno
// al día). Alcance: empleados activos de departamentos con
// trackWeeklyReview=true (el mismo conjunto que ya tenía la reunión 1:1),
// confirmado con el usuario — no se expande a toda la empresa por ahora.
export async function getWeeklyCheckinPushes(): Promise<WeeklyCheckinPush[]> {
  if (isoWeekdayOf(nowInEcuador()) !== 5) return [];

  const week = currentIsoWeek();
  const employees = await prisma.user.findMany({
    where: { isActive: true, deptId: { not: null }, department: { trackWeeklyReview: true } },
    select: { id: true },
  });
  if (employees.length === 0) return [];

  const reported = await prisma.weeklyReviewRecord.findMany({
    where: { week, reportedById: { in: employees.map((e) => e.id) } },
    select: { reportedById: true },
  });
  const done = new Set(reported.map((r) => r.reportedById));

  return employees
    .filter((e) => !done.has(e.id))
    .map((e) => ({
      ownerId: e.id,
      title: "DAFLOW · Reporte semanal",
      body: "¿Qué problemas tuviste esta semana? Cuéntaselo al asistente y arma tu plan de acción.",
      url: "/area",
    }));
}

export type InvolvingMeReviewDTO = {
  id: string;
  week: string;
  problem: string;
  actionPlan: string;
  status: "PENDING" | "RESOLVED" | "REJECTED";
  fromDeptName: string;
};

// "Reportes que me involucran" — registros de OTRAS áreas donde alguien
// nombró a este departamento completo, o a uno de sus propios colaboradores
// (no solo al líder que consulta). Solo lectura: quien lidera acá no cierra
// el registro ajeno, solo lo ve — cerrarlo sigue siendo del área dueña.
export async function getReviewsInvolvingUser(deptId: string): Promise<InvolvingMeReviewDTO[]> {
  const team = await prisma.user.findMany({ where: { deptId }, select: { id: true } });
  const teamIds = team.map((u) => u.id);

  const records = await prisma.weeklyReviewRecord.findMany({
    where: {
      deptId: { not: deptId },
      OR: [{ involvesDeptId: deptId }, { involvesUserId: { in: teamIds } }],
    },
    orderBy: { week: "desc" },
    include: { department: { select: { name: true } } },
  });

  return records.map((r) => ({
    id: r.id,
    week: r.week,
    problem: r.problem,
    actionPlan: r.actionPlan,
    status: r.status,
    fromDeptName: r.department.name,
  }));
}
