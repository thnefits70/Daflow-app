import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canUseWeeklyCheckin } from "@/lib/guards";
import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import {
  WEEKLY_CHECKIN_MODEL,
  WEEKLY_CHECKIN_SYSTEM_PROMPT,
  SUBMIT_WEEKLY_REPORT_TOOL,
  currentIsoWeek,
  resolveInvolvement,
  notifyInvolvedParties,
  type SubmitWeeklyReportInput,
} from "@/lib/weeklyCheckin";

const messageSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) });
const bodySchema = z.object({ messages: z.array(messageSchema).min(1).max(40) });

const submitReportSchema = z.object({
  hasIssues: z.boolean(),
  problem: z.string().trim().min(1),
  actionPlan: z.string().trim().min(1),
  involvesOtherDept: z.boolean(),
  involvedDeptName: z.string().trim().optional(),
  involvedPersonName: z.string().trim().optional(),
});

// Devuelve la conversación de ESTA semana (una por líder por semana, ver
// weeklyCheckin.ts) para que el widget cargue el historial al abrir — no
// existe un "listado de conversaciones" como en Nancy, porque solo hay una
// activa a la vez.
export async function GET() {
  const session = await auth();
  if (!session || !(await canUseWeeklyCheckin())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const conversation = await prisma.checkinConversation.findFirst({
    where: { ownerId: session.user.id, weekOf: currentIsoWeek() },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversation) return NextResponse.json({ id: null, messages: [] });
  return NextResponse.json({
    id: conversation.id,
    messages: conversation.messages.map((m) => ({ role: m.role, content: m.content })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canUseWeeklyCheckin())) {
    return new Response("No autorizado.", { status: 403 });
  }
  // deptId nunca viene del cliente — a diferencia de Nancy, acá decide a qué
  // bitácora cae el registro y a quién se notifica. Se resuelve por
  // leadsDeptId (el área que esta persona LIDERA), no por session.user.deptId
  // — canUseWeeklyCheckin() ya garantiza que sea un líder con área asignada.
  const leaderUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { leadsDeptId: true } });
  const deptId = leaderUser!.leadsDeptId!;
  const ownerId = session.user.id;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return new Response(parsed.error.issues[0]?.message ?? "Datos inválidos.", { status: 400 });
  }
  const { messages } = parsed.data;

  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role !== "user") {
    return new Response("El último mensaje debe ser del usuario.", { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response("El asistente todavía no está conectado — falta configurar la clave de Anthropic en el servidor.", {
      status: 503,
    });
  }

  const week = currentIsoWeek();
  let conversation = await prisma.checkinConversation.findFirst({ where: { ownerId, weekOf: week } });
  if (!conversation) {
    conversation = await prisma.checkinConversation.create({
      data: { ownerId, deptId, weekOf: week, title: lastMessage.content.slice(0, 60) },
    });
  }
  const conversationId = conversation.id;

  await prisma.checkinMessage.create({ data: { conversationId, role: "user", content: lastMessage.content } });

  const priorMessages = messages.slice(0, -1);
  const client = getAnthropicClient();
  const stream = client.messages.stream({
    model: WEEKLY_CHECKIN_MODEL,
    max_tokens: 1024,
    system: WEEKLY_CHECKIN_SYSTEM_PROMPT,
    tools: [SUBMIT_WEEKLY_REPORT_TOOL],
    messages: [...priorMessages.map((m) => ({ role: m.role, content: m.content })), { role: "user" as const, content: lastMessage.content }],
  });

  const encoder = new TextEncoder();
  let acc = "";
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            acc += event.delta.text;
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch {
        acc += "\n\n[Se perdió la conexión — intenta de nuevo.]";
        controller.enqueue(encoder.encode("\n\n[Se perdió la conexión — intenta de nuevo.]"));
      }

      // finalMessage() ya trae el input del tool call completamente
      // parseado (el SDK acumula los content_block_delta de tipo
      // input_json_delta internamente) — no hace falta acumular JSON a
      // mano ni hacer una segunda llamada al modelo.
      const finalMessage = await stream.finalMessage().catch(() => null);
      const toolBlock = finalMessage?.content.find(
        (b): b is typeof b & { type: "tool_use"; name: string; input: unknown } => b.type === "tool_use" && b.name === "submit_weekly_report"
      );

      if (toolBlock) {
        const reportParsed = submitReportSchema.safeParse(toolBlock.input);
        if (reportParsed.success) {
          const report: SubmitWeeklyReportInput = reportParsed.data;
          const { involvesDeptId, involvesUserId, involvesRaw } = report.involvesOtherDept
            ? await resolveInvolvement({ involvedDeptName: report.involvedDeptName, involvedPersonName: report.involvedPersonName })
            : { involvesDeptId: null, involvesUserId: null, involvesRaw: null };

          const record = await prisma.weeklyReviewRecord.create({
            data: {
              deptId,
              week,
              problem: report.hasIssues ? report.problem : "Sin novedades esta semana.",
              actionPlan: report.actionPlan,
              status: "PENDING",
              source: "ASSISTANT",
              reportedById: ownerId,
              involvesDeptId,
              involvesUserId,
              involvesRaw,
            },
          });
          await notifyInvolvedParties(record).catch((err) => console.error("notifyInvolvedParties falló:", err));

          if (!acc.trim()) {
            const closing = "Gracias, quedó registrado. ¡Que tengas buena semana!";
            acc += closing;
            controller.enqueue(encoder.encode(closing));
          }
        } else if (!acc.trim()) {
          const closing = "No pude registrar el reporte completo — ¿puedes contarme de nuevo cuál fue el problema y el plan?";
          acc += closing;
          controller.enqueue(encoder.encode(closing));
        }
      }

      controller.close();

      if (acc.trim()) {
        await prisma.checkinMessage.create({ data: { conversationId, role: "assistant", content: acc } });
      }
      await prisma.checkinConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });

      if (finalMessage?.usage) {
        await logAiUsage({
          feature: "weekly_checkin",
          model: WEEKLY_CHECKIN_MODEL,
          actorId: ownerId,
          deptId,
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
        });
      }
    },
  });

  return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
