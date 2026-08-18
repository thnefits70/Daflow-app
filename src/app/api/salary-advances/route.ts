import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendPushToOwner } from "@/lib/webPush";
import { actorName } from "@/lib/actorName";

export async function GET() {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json([]);

  const advances = await prisma.salaryAdvance.findMany({
    where: { employeeId: session.user.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(advances);
}

const schema = z
  .object({
    amount: z.number().positive(),
    justification: z.string().trim().optional(),
    installments: z.number().int().min(1).max(3),
  })
  .refine((d) => d.amount <= 100 || (d.justification && d.justification.length > 0), {
    message: "Arriba de $100 hay que justificar el motivo.",
    path: ["justification"],
  })
  .refine((d) => d.installments === 1 || d.amount > 50, {
    message: "Solo se puede pagar en cuotas si el monto es mayor a $50.",
    path: ["installments"],
  });

// Confirmado 2026-08-18: cualquier colaborador puede pedir cualquier monto
// — sin guard especial. Necesita tener su cuenta bancaria registrada antes.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const account = await prisma.employeeBankAccount.findUnique({ where: { employeeId: session.user.id } });
  if (!account) return NextResponse.json({ error: "Primero registrá tu cuenta bancaria." }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const advance = await prisma.salaryAdvance.create({
    data: {
      employeeId: session.user.id,
      amount: parsed.data.amount,
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
