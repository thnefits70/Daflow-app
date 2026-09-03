import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSubmitCancelledGuide, canManageCancelledGuideBatches } from "@/lib/guards";
import { nextCancelledGuideNumber, formatCancelledGuideCode, nextCancelledGuideBatchNumber, formatCancelledGuideBatchCode, notifyCancelledGuideBatchSubmitted, notifyMarketingLeadBatchReceived, notifyItemAssigneesNewBatch } from "@/lib/cancelledGuides";
import { MKT_CANCEL_REASONS, FULFILLMENT_CANCEL_REASONS } from "@/lib/cancelledGuidesLabels";

// Bryan (líder MKT) ve los lotes todavía sin gestionar, agrupados por
// batchCode — el cliente arma la agrupación, acá va la lista plana.
export async function GET() {
  const session = await auth();
  if (!(await canManageCancelledGuideBatches()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const reports = await prisma.cancelledGuideReport.findMany({
    where: { batchManagedAt: null, batchCode: { not: null } },
    select: { id: true, code: true, batchCode: true, sourceArea: true, carrier: true, reason: true, guideNumber: true, createdAt: true, submittedBy: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(reports);
}

// Yair (o cualquiera de MKT/FUL) confirma un lote: todas las guías de UNA
// misma transportadora que subió seguidas, listas para que Bryan las
// gestione con la transportadora/Dropi. Sin productos todavía — eso lo
// carga después quien tenga canAssignCancelledGuideItems (ver docblock de
// CancelledGuideReport en el schema).
const schema = z.object({
  sourceArea: z.enum(["MKT_DAMIAN", "MKT_PROVEDIX", "MKT_SHANGHAI", "FULFILLMENT"]),
  carrier: z.enum(["SERVIENTREGA", "URBANO", "GINTRANCOM", "LAARCOURIER", "VELOCES"]),
  reason: z.string().trim().min(1, "Falta el motivo."),
  guideNumbers: z.array(z.string().trim().min(1)).min(1, "Agregá al menos una guía."),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canSubmitCancelledGuide()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const allowedReasons = parsed.data.sourceArea === "FULFILLMENT" ? [...FULFILLMENT_CANCEL_REASONS, "Otro"] : [...MKT_CANCEL_REASONS, "Otro"];
  const isKnownReason = allowedReasons.some((r) => parsed.data.reason === r) || parsed.data.reason.length > 0;
  if (!isKnownReason) return NextResponse.json({ error: "Motivo inválido." }, { status: 400 });

  // Una guía repetida duplicaría todo el flujo de acá para adelante (Bryan
  // la gestiona dos veces, Heidy carga productos dos veces, Daniel reingresa
  // mercadería dos veces) — se rechaza si esa guía ya fue reportada antes,
  // sin importar cuándo ni en qué lote (pedido explícito de Yair 2026-09-03).
  const guideNumbersInPayload = parsed.data.guideNumbers;
  const dupesInPayload = guideNumbersInPayload.filter((g, i) => guideNumbersInPayload.indexOf(g) !== i);
  const existing = await prisma.cancelledGuideReport.findMany({
    where: { carrier: parsed.data.carrier, guideNumber: { in: guideNumbersInPayload } },
    select: { guideNumber: true },
  });
  const dupeSet = new Set([...dupesInPayload, ...existing.map((e) => e.guideNumber)]);
  if (dupeSet.size > 0) {
    return NextResponse.json({ error: `Ya reportada antes, no se puede repetir: ${[...dupeSet].join(", ")}` }, { status: 400 });
  }

  const batchNumber = await nextCancelledGuideBatchNumber();
  const batchCode = formatCancelledGuideBatchCode(batchNumber);

  // Numeramos cada guía primero (correlativo atómico, uno por uno) para
  // poder crearlas todas juntas con code/reportNumber ya definidos.
  const rows = [];
  for (const guideNumber of parsed.data.guideNumbers) {
    const reportNumber = await nextCancelledGuideNumber();
    rows.push({
      code: formatCancelledGuideCode(reportNumber),
      reportNumber,
      submittedById: session.user.id,
      sourceArea: parsed.data.sourceArea,
      guideNumber,
      carrier: parsed.data.carrier,
      reason: parsed.data.reason,
      batchCode,
    });
  }

  await prisma.cancelledGuideReport.createMany({ data: rows });

  // Bryan y Heidy (o quien tenga canAssignCancelledGuideItems) se enteran
  // al mismo tiempo — los dos pasos corren en paralelo, ninguno espera al
  // otro (pedido explícito del usuario 2026-09-02).
  await Promise.all([
    notifyCancelledGuideBatchSubmitted(batchCode, rows.length),
    notifyMarketingLeadBatchReceived(batchCode, rows.length),
    notifyItemAssigneesNewBatch(batchCode, rows.length),
  ]);

  return NextResponse.json({ batchCode, count: rows.length });
}
