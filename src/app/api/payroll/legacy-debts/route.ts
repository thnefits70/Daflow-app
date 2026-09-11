import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageLegacyPayrollDebts, canViewPayrollRoles } from "@/lib/guards";
import { resolveFirstPayoutMonth } from "@/lib/payroll";
import { sendPushToOwner } from "@/lib/webPush";

function currentMonthStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Admin ve lo mismo que Nairoby, de solo lectura — mismo criterio que el
// resto de la calculadora de roles de pago (canViewPayrollRoles).
export async function GET() {
  if (!(await canViewPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const debts = await prisma.legacyPayrollDebt.findMany({
    include: { employee: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(debts);
}

const schema = z.object({
  employeeId: z.string().min(1),
  totalAmount: z.number().positive(),
  reason: z.string().trim().min(1, "Contá de qué deuda se trata."),
  installments: z.number().int().min(1).max(6),
});

// Confirmado 2026-09-11: exclusivo de Nairoby (canManageLegacyPayrollDebts,
// sin bypass de admin), sin paso de aceptación del colaborador — a
// diferencia de ManagementDeduction, firstPayoutMonth se resuelve de una
// vez, siempre al mes actual (esto es para cargar deuda ya conocida de
// antes del sistema, no algo que el colaborador deba confirmar primero).
export async function POST(req: NextRequest) {
  if (!(await canManageLegacyPayrollDebts())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const session = await auth();
  const firstPayoutMonth = await resolveFirstPayoutMonth(currentMonthStr());

  const debt = await prisma.legacyPayrollDebt.create({
    data: { ...parsed.data, firstPayoutMonth, createdById: session?.user.id },
    include: { employee: { select: { name: true } } },
  });

  await sendPushToOwner(parsed.data.employeeId, {
    title: "Deuda anterior registrada en tu rol de pago",
    body: `$${parsed.data.totalAmount.toFixed(2)} — ${parsed.data.reason} (en ${parsed.data.installments} cuota${parsed.data.installments > 1 ? "s" : ""})`,
    url: "/area/roles-de-pago",
  }).catch(() => null);

  return NextResponse.json(debt, { status: 201 });
}
