import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEditPayrollRoles } from "@/lib/guards";
import { computeMonthlyLegalRole } from "@/lib/payrollCalc";

const schema = z.object({
  changeNote: z.string().trim().min(1, "Contá qué cambió — el colaborador va a ver esta nota."),
});

// Confirmado 2026-08-13: pedido explícito del usuario — esta es la que SÍ
// ve el colaborador, así que la nota de cambio también la ve él (a
// diferencia de la corrección de PayrollQuincenaRole, que es solo interna).
// Recalcula desde el PayrollProfile vigente en este momento — si lo que
// estaba mal era el sueldo declarado, hay que corregirlo ahí primero.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canEditPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const session = await auth();
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const current = await prisma.monthlyLegalRole.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!current.isCurrent) return NextResponse.json({ error: "Esta ya no es la versión vigente." }, { status: 409 });

  const profile = await prisma.payrollProfile.findUnique({ where: { userId: current.employeeId } });
  if (!profile?.iessDeclaredSalary) {
    return NextResponse.json({ error: "Este colaborador no tiene sueldo declarado configurado en Nómina." }, { status: 400 });
  }
  const legal = computeMonthlyLegalRole(profile.iessDeclaredSalary, profile.companyAbsorbsIess);
  const isAdmin = session!.user.role === "admin";

  const [, created] = await prisma.$transaction([
    prisma.monthlyLegalRole.update({ where: { id }, data: { isCurrent: false } }),
    prisma.monthlyLegalRole.create({
      data: {
        employeeId: current.employeeId,
        month: current.month,
        version: current.version + 1,
        isCurrent: true,
        changeNote: parsed.data.changeNote.trim(),
        publishedById: isAdmin ? null : session!.user.id,
        ...legal,
      },
    }),
  ]);

  return NextResponse.json(created);
}
