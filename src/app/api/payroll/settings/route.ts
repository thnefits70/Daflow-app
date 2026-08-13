import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewPayrollRoles, canEditPayrollRoles } from "@/lib/guards";

// Fila única — se reutiliza siempre la primera que exista, se crea si no
// hay ninguna todavía.
const SETTINGS_ID = "payroll-settings-singleton";

export async function GET() {
  if (!(await canViewPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const settings = await prisma.payrollSettings.findUnique({ where: { id: SETTINGS_ID } });
  return NextResponse.json(settings ?? { nationalBaseSalary: null });
}

const schema = z.object({ nationalBaseSalary: z.number().positive() });

export async function PATCH(req: NextRequest) {
  if (!(await canEditPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const session = await auth();
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const isAdmin = session?.user.role === "admin";
  const settings = await prisma.payrollSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { nationalBaseSalary: parsed.data.nationalBaseSalary, updatedById: isAdmin ? null : session!.user.id },
    create: { id: SETTINGS_ID, nationalBaseSalary: parsed.data.nationalBaseSalary, updatedById: isAdmin ? null : session!.user.id },
  });
  return NextResponse.json(settings);
}
