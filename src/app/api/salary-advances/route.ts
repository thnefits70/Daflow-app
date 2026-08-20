import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendPushToOwner } from "@/lib/webPush";
import { actorName } from "@/lib/actorName";
import {
  pendingSalaryAdvanceBalance,
  SALARY_ADVANCE_MIN_AMOUNT,
  SALARY_ADVANCE_NO_JUSTIFICATION_MAX,
  SALARY_ADVANCE_MAX_AMOUNT,
  SALARY_ADVANCE_PENDING_CAP,
} from "@/lib/payroll";

export async function GET() {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json({ items: [], pendingTotal: 0 });

  const items = await prisma.salaryAdvance.findMany({
    where: { employeeId: session.user.id },
    orderBy: { createdAt: "desc" },
  });
  const pendingTotal = await pendingSalaryAdvanceBalance(session.user.id);
  return NextResponse.json({ items, pendingTotal });
}

const schema = z
  .object({
    amount: z
      .number()
      .min(SALARY_ADVANCE_MIN_AMOUNT, `El anticipo mínimo es $${SALARY_ADVANCE_MIN_AMOUNT}.`)
      .max(SALARY_ADVANCE_MAX_AMOUNT, `El anticipo máximo es $${SALARY_ADVANCE_MAX_AMOUNT}.`),
    reason: z.enum(["EMERGENCIA_FAMILIAR", "OTRO"]).optional(),
    justification: z.string().trim().optional(),
    installments: z.number().int().min(1).max(4),
  })
  .refine((d) => d.amount <= SALARY_ADVANCE_NO_JUSTIFICATION_MAX || !!d.reason, {
    message: `Arriba de $${SALARY_ADVANCE_NO_JUSTIFICATION_MAX} hay que elegir un motivo.`,
    path: ["reason"],
  })
  .refine(
    (d) =>
      d.amount <= SALARY_ADVANCE_NO_JUSTIFICATION_MAX ||
      d.reason !== "OTRO" ||
      (d.justification && d.justification.trim().length >= 10),
    {
      message: "Contá brevemente el motivo (mínimo 10 caracteres).",
      path: ["justification"],
    }
  )
  .refine((d) => d.installments === 1 || d.amount > 50, {
    message: "Solo se puede pagar en cuotas si el monto es mayor a $50.",
    path: ["installments"],
  });

// Confirmado 2026-08-20: reglas de monto/motivo/tope pendiente definidas con
// el usuario — ver constantes SALARY_ADVANCE_* en payroll.ts. Necesita tener
// su cuenta bancaria registrada antes.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const account = await prisma.employeeBankAccount.findFirst({ where: { employeeId: session.user.id, isSelected: true } });
  if (!account) return NextResponse.json({ error: "Primero registrá tu cuenta bancaria." }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const pendingTotal = await pendingSalaryAdvanceBalance(session.user.id);
  if (pendingTotal >= SALARY_ADVANCE_PENDING_CAP) {
    return NextResponse.json(
      {
        error: `Ya tenés $${pendingTotal.toFixed(2)} pendientes de pago en anticipos. Esperá a completar las cuotas actuales antes de pedir uno nuevo.`,
      },
      { status: 400 }
    );
  }

  const advance = await prisma.salaryAdvance.create({
    data: {
      employeeId: session.user.id,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
      justification: parsed.data.justification?.trim(),
      installments: parsed.data.installments,
    },
  });

  await sendPushToOwner("admin", {
    title: "💵 Nueva solicitud de anticipo",
    body: `${actorName(session.user.name)} · $${parsed.data.amount.toFixed(2)}${parsed.data.installments > 1 ? ` a ${parsed.data.installments} cuotas` : ""}`,
    url: "/admin/nomina?tab=pagos&ptab=anticipos",
  }).catch(() => null);

  return NextResponse.json(advance, { status: 201 });
}
