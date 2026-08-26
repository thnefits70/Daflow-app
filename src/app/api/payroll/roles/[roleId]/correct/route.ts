import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEditPayrollRoles } from "@/lib/guards";
import { totalsFromLineItems } from "@/lib/payroll";

const schema = z.object({
  changeNote: z.string().trim().min(1, "Contá qué cambió — queda como nota interna."),
  lineItems: z
    .array(
      z.object({
        label: z.string().trim().min(1),
        amount: z.number().min(0),
        kind: z.enum(["INCOME", "EXPENSE"]),
        isAutomatic: z.boolean().optional(),
        note: z.string().optional(),
      })
    )
    .min(1, "El rol no puede quedar sin ningún concepto — dejá al menos uno."),
});

// Confirmado 2026-08-13: pedido explícito del usuario — nunca se
// sobreescribe un rol ya publicado. Se crea una versión nueva "principal"
// (isCurrent=true), la anterior queda de historial (isCurrent=false), con
// una nota interna obligatoria de qué cambió.
export async function POST(req: NextRequest, { params }: { params: Promise<{ roleId: string }> }) {
  if (!(await canEditPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const session = await auth();
  const { roleId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const current = await prisma.payrollQuincenaRole.findUnique({ where: { id: roleId }, include: { period: true } });
  if (!current) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!current.isCurrent) return NextResponse.json({ error: "Esta ya no es la versión vigente." }, { status: 409 });
  if (current.period.status !== "PUBLISHED") {
    return NextResponse.json({ error: "Todavía no está publicado — editalo directo en vez de corregir." }, { status: 409 });
  }

  const totals = totalsFromLineItems(parsed.data.lineItems);
  const isAdmin = session!.user.role === "admin";

  const [, created] = await prisma.$transaction([
    prisma.payrollQuincenaRole.update({ where: { id: roleId }, data: { isCurrent: false } }),
    prisma.payrollQuincenaRole.create({
      data: {
        periodId: current.periodId,
        employeeId: current.employeeId,
        version: current.version + 1,
        isCurrent: true,
        changeNote: parsed.data.changeNote.trim(),
        createdById: isAdmin ? null : session!.user.id,
        ...totals,
        lineItems: { create: parsed.data.lineItems.map((i) => ({ ...i, isAutomatic: i.isAutomatic ?? false })) },
      },
      include: { lineItems: true },
    }),
  ]);

  return NextResponse.json(created);
}
