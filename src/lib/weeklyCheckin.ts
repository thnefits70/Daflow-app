import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { getDeptLeadId, getLeadIdOfUsersDept } from "@/lib/guards";

// Mary, la asistente de check-in semanal — reemplaza la reunión 1:1
// admin-líder: le pregunta al LÍDER de cada área (nunca al resto del
// equipo) qué problemas tuvo esta semana, HACE SEGUIMIENTO REAL de lo que
// quedó pendiente en semanas anteriores (nunca deja que un líder "marque
// por marcar" sin explicar qué hizo — ver getOpenPreviousReports/
// CLOSE_PREVIOUS_REPORT_TOOL más abajo), y arma el registro en
// WeeklyReviewRecord sola. Separada de Nancy/FERNICK (ver esos archivos);
// modelo más liviano porque esto es captura de datos, no análisis
// financiero. Confirmado 2026-08-27: el único que puede cambiar el estado
// de un registro a mano (sin pasar por Mary) sigue siendo el admin — un
// líder ya no tiene ese dropdown, precisamente para que "Solucionado"
// signifique algo.
export const WEEKLY_CHECKIN_MODEL = "claude-sonnet-5";

export const MARY_SYSTEM_PROMPT = `Eres Mary, la asistente de check-in semanal de DAFLOW para Provedix (Guayaquil, Ecuador). Tu tono es femenino, profesional y cercano — cálida pero directa, nunca robótica ni acartonada. Tu trabajo es conversar con el líder de un área para levantar su reporte semanal y darle seguimiento real a lo que había quedado pendiente — reemplazas la reunión de 1:1 que antes se hacía en persona.

Al iniciar una conversación nueva, saluda por su nombre — el contexto de cada mensaje te dice con quién hablas y qué área lidera.

Si el contexto trae "PENDIENTES DE SEMANAS ANTERIORES", pregunta por ESOS primero, uno por uno, antes de preguntar por problemas nuevos:
- Si el líder explica con detalle qué hizo para resolverlo, llama a close_previous_report con esa explicación como resolutionNote (usa el id exacto que viene entre corchetes en el contexto).
- Si solo dice "ya", "listo", "sí lo hice" o algo igual de vago sin explicar QUÉ hizo, pídele que cuente exactamente qué acción tomó — nunca cierres un pendiente con una nota vacía o genérica.
- Si dice que sigue sin resolverlo, no llames ninguna herramienta para ese ítem — sigue tal cual, en Pendiente, y continúa la conversación con naturalidad.

Después de eso (o directo, si no había pendientes), pregunta qué problemas o dificultades nuevas tuvo esta semana:
- Si menciona un problema, pregunta cuál es su plan para resolverlo (qué va a hacer, no solo qué pasó).
- Pregunta siempre, antes de cerrar, si resolverlo depende de que se involucre OTRA ÁREA, el LÍDER de otra área, o un COLABORADOR específico de otro equipo — y si es así, de qué área o de quién se trata (nombre).
- Si dice que no tuvo problemas nuevos esta semana, regístralo igual como "sin novedades" — no insistas ni inventes un problema.

El check-in es sobre el trabajo del área — problemas operativos, capacidad, personal, tiempos de despacho — nunca sobre temas personales o de bienestar individual del líder (salud, comida, vida personal). Si el líder menciona algo así de pasada, respóndele con una sola frase breve y cálida — sin indagar, sin preguntarle si lo va a manejar él o si hay que avisar a alguien — y vuelve enseguida a la pregunta del check-in que estabas haciendo. Nunca abras una segunda vuelta de preguntas sobre un tema así; tu trabajo es mantener la conversación enfocada en el área y en la meta, no seguirle la corriente a lo que no tiene que ver con eso.

Tienes una meta de fondo que compartes con todo el equipo: llegar a los 1000 pedidos diarios. No es una orden que bajas al líder desde arriba — es tu meta también, así que háblala en primera persona del plural ("nosotros", "entre todos", "la meta que tenemos"), nunca como "ustedes deben llegar a...". Sácala a relucir de forma sutil, solo cuando el problema o el plan que te está contando realmente se conecta con volumen, capacidad, personal o tiempos de despacho — no la menciones en temas que no tienen nada que ver. Cuando sí aplique, no te quedes en anotar el plan tal cual te lo dan: ayuda al líder a pensar un paso más allá, hacia esa meta — por ejemplo, preguntando si el plan también aguanta si el volumen sigue subiendo, o si hay algo más que valdría la pena hacer pensando en llegar a los 1000. La idea es que el líder sienta que esa meta es del equipo completo, tú incluida, no una tarea más que le toca cumplir a él solo.

Sé breve y directa, en español. No es una entrevista larga — en pocos intercambios ya deberías tener lo necesario.

Cuándo registrar:
- Llama a submit_weekly_report SOLO cuando ya tengas claro el problema nuevo (o la ausencia de problemas nuevos) y el plan de acción — nunca antes, y nunca más de una vez por conversación.
- No inventes nombres de áreas o personas que el líder no mencionó — si no dijo que involucra a alguien más, involvesOtherDept es false.
- submit_weekly_report y close_previous_report son independientes — puedes llamar una, la otra, ambas, o ninguna, según lo que de verdad haya pasado en la conversación.`;

export const SUBMIT_WEEKLY_REPORT_TOOL = {
  name: "submit_weekly_report",
  description:
    "Registra el reporte semanal NUEVO del líder del área. Llamar solo una vez que el problema (o la ausencia de problemas nuevos) y el plan de acción están claros.",
  input_schema: {
    type: "object" as const,
    properties: {
      hasIssues: { type: "boolean", description: "true si tuvo algún problema nuevo esta semana, false si no tuvo novedades." },
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

// Es el mecanismo que de verdad comprueba que se hizo algo — a diferencia
// de un dropdown que el líder controlaba directamente (revertido, ver
// api/weekly-reviews/[id]/route.ts), Mary decide el cierre y exige una
// explicación real, nunca un "ya" vacío.
export const CLOSE_PREVIOUS_REPORT_TOOL = {
  name: "close_previous_report",
  description:
    "Marca un reporte de una semana anterior como Solucionado. Llamar solo cuando el líder explique con detalle qué hizo exactamente — nunca si solo confirma vagamente que 'ya lo hizo'.",
  input_schema: {
    type: "object" as const,
    properties: {
      recordId: { type: "string", description: "El id (dado en el contexto entre corchetes, ej. [id: xxxx]) del pendiente que se está cerrando." },
      resolutionNote: { type: "string", description: "Qué hizo exactamente el líder para resolverlo, en sus propias palabras — nunca vacío ni genérico." },
    },
    required: ["recordId", "resolutionNote"],
  },
};

export type ClosePreviousReportInput = { recordId: string; resolutionNote: string };

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

// Mismo cálculo de "lunes de esa semana ISO" que ya usa pendingTasks.ts
// (mondayOfIsoWeek, privada allá) — copia local, mismo criterio de
// duplicar date-math pequeño entre archivos que ya siguen entre sí
// pendingTasks.ts/periodicReminders.ts.
function mondayOfIsoWeek(week: string): Date {
  const [yearStr, wStr] = week.split("-W");
  const year = Number(yearStr);
  const weekNum = Number(wStr);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (weekNum - 1) * 7);
  return target;
}

// Cuántas semanas ISO de diferencia hay entre `week` y la semana actual —
// usado tanto para armarle el contexto a Mary ("hace N semanas") como para
// el chip de "lleva N semanas pendiente" en WeeklyReviewPanel.tsx.
export function weeksStaleOf(week: string): number {
  const then = mondayOfIsoWeek(week);
  const now = mondayOfIsoWeek(currentIsoWeek());
  return Math.round((now.getTime() - then.getTime()) / (7 * 86400000));
}

export type OpenPreviousReport = { id: string; week: string; problem: string; actionPlan: string; weeksStale: number };

// Todo lo que este líder dejó Pendiente en semanas anteriores (nunca la
// semana actual) — Mary pregunta por cada uno antes de pasar a problemas
// nuevos, ver MARY_SYSTEM_PROMPT.
export async function getOpenPreviousReports(leaderId: string, currentWeek: string): Promise<OpenPreviousReport[]> {
  const rows = await prisma.weeklyReviewRecord.findMany({
    where: { reportedById: leaderId, status: "PENDING", week: { not: currentWeek } },
    orderBy: { week: "asc" },
  });
  return rows.map((r) => ({ id: r.id, week: r.week, problem: r.problem, actionPlan: r.actionPlan, weeksStale: weeksStaleOf(r.week) }));
}

// Contexto inyectado en cada mensaje enviado al modelo — mismo patrón que
// buildNancyContext en nancy.ts (nunca confiar en que el cliente mande el
// nombre/área; siempre resuelto server-side). Antepuesto al contenido del
// último mensaje del usuario en la ruta.
export function buildWeeklyCheckinContext(params: { leaderName: string; deptName: string; openPrevious: OpenPreviousReport[] }): string {
  let ctx = `CONTEXTO\nEstás hablando con ${params.leaderName}, líder de ${params.deptName}.`;
  if (params.openPrevious.length > 0) {
    const lines = params.openPrevious
      .map(
        (r) =>
          `- [id: ${r.id}] Semana ${r.week} (hace ${r.weeksStale} semana${r.weeksStale === 1 ? "" : "s"}): "${r.problem}" — plan: "${r.actionPlan}"`
      )
      .join("\n");
    ctx += `\n\nPENDIENTES DE SEMANAS ANTERIORES (pregunta por cada uno antes de seguir con problemas nuevos):\n${lines}`;
  }
  return ctx;
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
// recibe una tarea sin que su líder lo sepa). Si nombraron un ÁREA completa,
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

// Saludo con el que Mary "abre" la conversación ella sola los viernes —
// confirmado 2026-08-31, pedido explícito del usuario: el check-in no debe
// depender de que el líder sepa qué escribir primero. Es una plantilla
// simple armada en el servidor, sin llamar al modelo (sin costo de IA
// nuevo) — retoma el pendiente más viejo si hay alguno, igual que Mary lo
// haría en vivo (ver MARY_SYSTEM_PROMPT), y la conversación real con el
// modelo arranca recién cuando el líder responde.
function buildOpeningMessage(leaderName: string, openPrevious: OpenPreviousReport[]): string {
  const greeting = `¡Hola, ${leaderName}! 😊`;
  if (openPrevious.length > 0) {
    const first = openPrevious[0];
    const weeksLabel = `${first.weeksStale} semana${first.weeksStale === 1 ? "" : "s"}`;
    return `${greeting} Antes de ver cómo va esta semana, quiero retomar un pendiente de hace ${weeksLabel}:\n\n"${first.problem}" — el plan era: "${first.actionPlan}".\n\n¿Cómo quedó eso, ya lo resolviste?`;
  }
  return `${greeting} ¿Qué problemas tuvo tu área esta semana?`;
}

// Recordatorio de los viernes — reutiliza el único cron diario existente
// (ver /api/cron/push-pendientes), filtrando por día de la semana en vez de
// crear un cron nuevo (Vercel Hobby no permite crons más frecuentes que uno
// al día). Alcance: solo LÍDERES activos de departamentos con
// trackWeeklyReview=true (el mismo conjunto que ya tenía la reunión 1:1) —
// confirmado con el usuario 2026-08-26: el asistente reemplaza la reunión
// con el líder, no le pregunta al resto del equipo.
export async function getWeeklyCheckinPushes(): Promise<WeeklyCheckinPush[]> {
  if (isoWeekdayOf(nowInEcuador()) !== 5) return [];

  const week = currentIsoWeek();
  const leaders = await prisma.user.findMany({
    where: { isActive: true, isLeader: true, leadsDept: { trackWeeklyReview: true } },
    select: { id: true, name: true, leadsDeptId: true },
  });
  if (leaders.length === 0) return [];

  const reported = await prisma.weeklyReviewRecord.findMany({
    where: { week, reportedById: { in: leaders.map((l) => l.id) } },
    select: { reportedById: true },
  });
  const done = new Set(reported.map((r) => r.reportedById));
  const pending = leaders.filter((l) => !done.has(l.id));

  const pushes: WeeklyCheckinPush[] = [];
  for (const leader of pending) {
    // Solo se deja la pregunta escrita si esta persona no tiene ya una
    // conversación abierta esta semana — si ya empezó a chatear por su
    // cuenta (ej. reportó antes del viernes), no se le pisa nada.
    const existing = await prisma.checkinConversation.findFirst({ where: { ownerId: leader.id, weekOf: week } });
    if (!existing) {
      const openPrevious = await getOpenPreviousReports(leader.id, week);
      const opening = buildOpeningMessage(leader.name, openPrevious);
      const conversation = await prisma.checkinConversation.create({
        data: { ownerId: leader.id, deptId: leader.leadsDeptId!, weekOf: week, title: opening.slice(0, 60) },
      });
      await prisma.checkinMessage.create({ data: { conversationId: conversation.id, role: "assistant", content: opening } });
    }

    pushes.push({
      ownerId: leader.id,
      title: "DAFLOW · Reporte semanal",
      body: "Mary te dejó una pregunta sobre esta semana — entra a contestarle.",
      url: "/area",
    });
  }
  return pushes;
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
