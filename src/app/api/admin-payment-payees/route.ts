import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageAdminPayments } from "@/lib/guards";
import { getAdminPaymentPayees } from "@/lib/adminPayments";

export async function GET() {
  if (!(await canManageAdminPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  return NextResponse.json(await getAdminPaymentPayees());
}

const schema = z.object({ name: z.string().trim().min(1, "Falta el nombre.") });

// Confirmado 2026-08-06: escribe-o-elige, mismo patrón que proveedores de
// Control de Compras — se crea sobre la marcha si no existe todavía.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canManageAdminPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const isAdmin = session.user.role === "admin";
  const payee = await prisma.adminPaymentPayee.upsert({
    where: { name: parsed.data.name },
    update: {},
    create: { name: parsed.data.name, createdById: isAdmin ? null : session.user.id },
    include: { bankAccounts: true },
  });
  return NextResponse.json(payee, { status: 201 });
}
