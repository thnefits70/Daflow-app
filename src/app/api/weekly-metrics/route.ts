import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canEditDeptKpis, canJustifyFillRate } from "@/lib/guards";
import { getOldestUnjustifiedFillRateWeek } from "@/lib/dashboard";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const deptId = req.nextUrl.searchParams.get("deptId");
  if (!deptId) return NextResponse.json({ error: "Falta deptId." }, { status: 400 });

  const records = await prisma.weeklyMetricRecord.findMany({
    where: { deptId },
    orderBy: { week: "asc" },
  });
  return NextResponse.json(records);
}

const weekRegex = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

const createSchema = z.object({
  deptId: z.string().min(1),
  week: z.string().regex(weekRegex, "Formato de semana inválido."),
  value: z.number().int().min(0),
  prepared: z.number().int().min(0).nullable().optional(),
  generated: z.number().int().min(0).nullable().optional(),
  outOfStock: z.number().int().min(0).nullable().optional(),
  justification: z.string().trim().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const { deptId, week, value, prepared, generated, outOfStock, justification } = parsed.data;
  if (!(await canEditDeptKpis(deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  // Confirmado 2026-07-28: notDispatched pasa a ser la suma de las 3
  // categorías nuevas (preparadas + generadas + falta de stock), ya no un
  // campo suelto — se sigue guardando para que el Fill Rate histórico
  // (semanas ya cargadas antes de este cambio) siga funcionando igual.
  const hasBreakdown = prepared != null || generated != null || outOfStock != null;
  const notDispatched = hasBreakdown ? (prepared ?? 0) + (generated ?? 0) + (outOfStock ?? 0) : null;

  // Confirmado 2026-09-08: pedido explícito del usuario — si el líder ya
  // tiene una semana ANTERIOR en alerta sin explicar, no puede seguir
  // registrando semanas nuevas hasta resolverla (ver
  // getOldestUnjustifiedFillRateWeek) — evita que el backlog se acumule en
  // silencio si un día se salta la explicación por cualquier motivo. No
  // aplica a quien no puede justificar (ej. admin), igual que el resto de
  // esta regla.
  if (await canJustifyFillRate()) {
    const backlog = await getOldestUnjustifiedFillRateWeek(deptId, week);
    if (backlog) {
      return NextResponse.json(
        {
          error: `Todavía tienes la semana ${backlog.week} sin explicar (quedó en ${backlog.fillRatePct}%, alerta) — escribe esa explicación antes de registrar una semana nueva.`,
        },
        { status: 400 }
      );
    }
  }

  // Confirmado 2026-09-08: pedido explícito del usuario — si esta semana ya
  // queda en alerta (<95%, mismo umbral que needsJustification en
  // dashboard.ts) y quien registra es el líder de Fulfillment (el único que
  // puede escribir la explicación, ver canJustifyFillRate), el sistema lo
  // obliga a explicarle al equipo AHORA, en el mismo registro — ya no puede
  // quedar pendiente para después. Si quien registra no puede justificar
  // (ej. admin), no se bloquea: la semana se guarda igual y la explicación
  // queda pendiente como antes, a la espera del líder.
  const total = hasBreakdown ? value + notDispatched! : 0;
  const fillRatePct = total > 0 ? Math.round((value / total) * 100) : null;
  const needsJustification = fillRatePct !== null && fillRatePct < 95;
  if (needsJustification && (await canJustifyFillRate())) {
    if (!justification || justification.length < 10) {
      return NextResponse.json(
        { error: `Este Fill Rate quedó en ${fillRatePct}% (alerta) — agrega una explicación para el equipo antes de guardar.` },
        { status: 400 }
      );
    }
  }

  const session = await auth();
  const justificationData =
    needsJustification && justification && justification.length >= 10
      ? { fillRateJustification: justification, fillRateJustificationBy: session?.user.name ?? null, fillRateJustificationAt: new Date() }
      : {};

  const record = await prisma.weeklyMetricRecord.upsert({
    where: { deptId_week: { deptId, week } },
    update: { value, prepared, generated, outOfStock, notDispatched, ...justificationData },
    create: { deptId, week, value, prepared, generated, outOfStock, notDispatched, ...justificationData },
  });
  return NextResponse.json(record, { status: 201 });
}
