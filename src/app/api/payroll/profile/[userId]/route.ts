import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canViewPayrollRoles, canEditPayrollRoles } from "@/lib/guards";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  if (!(await canViewPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { userId } = await params;
  const profile = await prisma.payrollProfile.findUnique({ where: { userId } });
  return NextResponse.json(
    profile ?? {
      userId,
      realSalary: null,
      iessDeclaredSalary: null,
      companyAbsorbsIess: false,
      canLogOvertimeHours: false,
      usesFullLegalOvertimeSchedule: false,
      monthlySalaryOnly: false,
    }
  );
}

const schema = z.object({
  realSalary: z.number().positive().nullable().optional(),
  iessDeclaredSalary: z.number().positive().nullable().optional(),
  companyAbsorbsIess: z.boolean().optional(),
  canLogOvertimeHours: z.boolean().optional(),
  usesFullLegalOvertimeSchedule: z.boolean().optional(),
  monthlySalaryOnly: z.boolean().optional(),
});

// Confirmado 2026-08-13: exclusivo de Nairoby (canEditPayrollRoles) — el
// admin NUNCA edita esto, ni siquiera con requireAdminSession, a propósito.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  if (!(await canEditPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { userId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return NextResponse.json({ error: "Colaborador no encontrado." }, { status: 404 });

  const profile = await prisma.payrollProfile.upsert({
    where: { userId },
    update: parsed.data,
    create: { userId, ...parsed.data },
  });
  return NextResponse.json(profile);
}
