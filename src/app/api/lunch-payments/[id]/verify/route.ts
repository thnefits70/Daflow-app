import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageAdminPayments } from "@/lib/guards";
import { readAdminPaymentDeclaration } from "@/lib/adminPaymentAi";
import { formatLunchMotivo } from "@/lib/lunchPayments";
import { pushOwnerId } from "@/lib/pushOwner";
import { notifyOwner } from "@/lib/notifications";

const schema = z.object({ invoiceFileUrl: z.string().url(), invoiceFileName: z.string().optional() });

// Confirmado 2026-09-08: pedido explícito del usuario — Nairoby (o admin)
// baja la factura del SRI ella misma y la sube acá. La IA la lee y cruza el
// monto contra lo calculado (cantidad de almuerzos × precio) — si no
// coincide, se bloquea y no se crea nada, igual que el doc. de soporte de
// cualquier otro pago administrativo. Si coincide, RECIÉN ACÁ se crea el
// AdminPaymentRequest real (visible al admin) — antes de esto, el admin no
// debía verlo.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canManageAdminPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const submission = await prisma.lunchWeekSubmission.findUnique({ where: { id } });
  if (!submission) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (!submission.sentToVerificationAt) return NextResponse.json({ error: "Todavía no fue enviada por Daniel." }, { status: 409 });
  if (submission.verifiedAt) return NextResponse.json({ error: "Ya fue verificada." }, { status: 409 });

  const weekStartIso = submission.weekStart.toISOString().slice(0, 10);
  const weekEndIso = submission.weekEnd.toISOString().slice(0, 10);
  const pricePerLunch = submission.monto / submission.lunchCount;
  const motivo = formatLunchMotivo(weekStartIso, weekEndIso, submission.lunchCount, pricePerLunch);

  let declarationAiMatch: boolean;
  let declarationAiNote: string;
  try {
    const check = await readAdminPaymentDeclaration({
      fileUrl: parsed.data.invoiceFileUrl,
      expectedAmount: submission.monto,
      expectedMotivo: motivo,
      actorId: pushOwnerId(session),
    });
    if (!check.matches) {
      return NextResponse.json({ error: `La factura no coincide: ${check.note}`, aiNote: check.note, readAmount: check.readAmount }, { status: 409 });
    }
    declarationAiMatch = check.matches;
    declarationAiNote = check.note;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo leer la factura." }, { status: 500 });
  }

  const isAdmin = session.user.role === "admin";

  const created = await prisma.adminPaymentRequest.create({
    data: {
      type: "VARIABLE",
      motivo,
      monto: submission.monto,
      payeeId: submission.payeeId,
      bankAccountId: submission.bankAccountId,
      declarationFileUrl: parsed.data.invoiceFileUrl,
      declarationFileName: parsed.data.invoiceFileName ?? null,
      declarationAiMatch,
      declarationAiNote,
      lunchWeekStart: submission.weekStart,
      lunchWeekEnd: submission.weekEnd,
      lunchCount: submission.lunchCount,
      createdById: submission.registeredById,
    },
  });

  const updated = await prisma.lunchWeekSubmission.update({
    where: { id },
    data: {
      verifiedAt: new Date(),
      verifiedById: isAdmin ? null : session.user.id,
      adminPaymentRequestId: created.id,
    },
  });

  await notifyOwner("admin", {
    title: "🍽️ Nueva solicitud de pago — Almuerzos",
    body: `${motivo} — $${submission.monto.toFixed(2)}`,
    url: "/admin",
  }).catch(() => null);

  return NextResponse.json(updated);
}
