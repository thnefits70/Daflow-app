import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageAdminPayments } from "@/lib/guards";
import { readAdminPaymentDeclaration } from "@/lib/adminPaymentAi";
import { getAdminPaymentTemplates, getAdminPaymentTemplatesPendingThisMonth, getAdminPaymentPayees, currentPeriod } from "@/lib/adminPayments";
import { pushOwnerId } from "@/lib/pushOwner";
import { sendPushToOwner } from "@/lib/webPush";

export async function GET() {
  if (!(await canManageAdminPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const bankAccountSelect = { id: true, bankName: true, bankAccountType: true, bankAccountNumber: true, bankAccountHolder: true, holderIdType: true, holderIdNumber: true };
  const [requests, templates, pendingThisMonth, payees] = await Promise.all([
    prisma.adminPaymentRequest.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        template: { select: { id: true, motivo: true } },
        payee: { select: { id: true, name: true } },
        bankAccount: { select: bankAccountSelect },
        createdBy: { select: { name: true } },
        paidBy: { select: { name: true } },
        confirmedBy: { select: { name: true } },
      },
    }),
    getAdminPaymentTemplates(),
    getAdminPaymentTemplatesPendingThisMonth(),
    getAdminPaymentPayees(),
  ]);

  return NextResponse.json({ requests, templates, pendingThisMonth, payees });
}

const schema = z.object({
  type: z.enum(["RECURRING", "VARIABLE"]),
  templateId: z.string().optional(),
  newTemplateMotivo: z.string().trim().min(1).optional(),
  motivo: z.string().trim().min(1),
  monto: z.number().positive(),
  payeeId: z.string().optional(),
  bankAccountId: z.string().optional(),
  declarationFileUrl: z.string().url().optional(),
  declarationFileName: z.string().optional(),
});

// Confirmado 2026-08-06: el doc. de soporte es opcional, pero si viene, la
// IA lo cruza contra motivo+monto declarados y BLOQUEA el envío si no
// coincide (mismo nivel de exigencia que el comprobante de pago final) — así
// que esta ruta no crea nada hasta que ese chequeo pase.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canManageAdminPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const d = parsed.data;

  if (d.type === "RECURRING" && !d.templateId && !d.newTemplateMotivo) {
    return NextResponse.json({ error: "Falta elegir o escribir el motivo recurrente." }, { status: 400 });
  }

  const createdById = session.user.role === "admin" ? null : session.user.id;

  let declarationAiMatch: boolean | null = null;
  let declarationAiNote: string | null = null;
  if (d.declarationFileUrl) {
    try {
      const check = await readAdminPaymentDeclaration({
        fileUrl: d.declarationFileUrl,
        expectedAmount: d.monto,
        expectedMotivo: d.motivo,
        actorId: pushOwnerId(session),
      });
      if (!check.matches) {
        return NextResponse.json({ error: `El documento no coincide: ${check.note}`, aiNote: check.note, readAmount: check.readAmount }, { status: 409 });
      }
      declarationAiMatch = check.matches;
      declarationAiNote = check.note;
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo leer el documento." }, { status: 500 });
    }
  }

  let templateId = d.templateId ?? null;
  if (d.type === "RECURRING" && !templateId && d.newTemplateMotivo) {
    const template = await prisma.adminPaymentTemplate.upsert({
      where: { motivo: d.newTemplateMotivo },
      update: {},
      create: { motivo: d.newTemplateMotivo, createdById },
    });
    templateId = template.id;
  }

  const period = d.type === "RECURRING" ? currentPeriod() : null;
  if (templateId && period) {
    const existing = await prisma.adminPaymentRequest.findUnique({ where: { templateId_period: { templateId, period } } });
    if (existing) return NextResponse.json({ error: "Ya existe una solicitud registrada este mes para este motivo recurrente." }, { status: 409 });
  }

  const created = await prisma.adminPaymentRequest.create({
    data: {
      type: d.type,
      templateId,
      period,
      motivo: d.motivo,
      monto: d.monto,
      payeeId: d.payeeId || null,
      bankAccountId: d.bankAccountId || null,
      declarationFileUrl: d.declarationFileUrl ?? null,
      declarationFileName: d.declarationFileName ?? null,
      declarationAiMatch,
      declarationAiNote,
      createdById,
    },
  });

  await sendPushToOwner("admin", {
    title: "💰 Nueva solicitud de pago administrativo",
    body: `${d.motivo} — $${d.monto.toFixed(2)}`,
    url: "/admin",
  }).catch(() => null);

  return NextResponse.json(created, { status: 201 });
}
