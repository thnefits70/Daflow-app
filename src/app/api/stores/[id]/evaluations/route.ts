import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageStoreFeedback } from "@/lib/guards";

const createSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, "Mes inválido."),
  loyaltyScore: z.number().int().min(0).max(10),
  fulfillmentScore: z.number().int().min(1).max(5),
  qualityScore: z.number().int().min(1).max(5),
  stockScore: z.number().int().min(1).max(5),
  responseTimeScore: z.number().int().min(1).max(5),
  commercialTermsScore: z.number().int().min(1).max(5),
  communicationScore: z.number().int().min(1).max(5),
  comment: z.string().trim().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canManageStoreFeedback())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const store = await prisma.store.findUnique({ where: { id } });
  if (!store) return NextResponse.json({ error: "Tienda no encontrada." }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  const evaluatedById = session.user.role === "admin" ? null : session.user.id;
  const evaluation = await prisma.storeFeedbackEvaluation.create({
    data: {
      storeId: id,
      period: d.period,
      loyaltyScore: d.loyaltyScore,
      fulfillmentScore: d.fulfillmentScore,
      qualityScore: d.qualityScore,
      stockScore: d.stockScore,
      responseTimeScore: d.responseTimeScore,
      commercialTermsScore: d.commercialTermsScore,
      communicationScore: d.communicationScore,
      comment: d.comment ?? "",
      evaluatedById,
    },
  });

  return NextResponse.json(evaluation, { status: 201 });
}
