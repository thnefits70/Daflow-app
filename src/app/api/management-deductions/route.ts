import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCreateManagementDeduction } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

// Colaborador ve sus propios descuentos (aceptados o esperando su
// aceptación). Admin ve todos (para referencia/seguimiento).
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  if (session.user.role === "admin") {
    const all = await prisma.managementDeduction.findMany({
      include: { employee: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(all);
  }

  const own = await prisma.managementDeduction.findMany({
    where: { employeeId: session.user.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(own);
}

const schema = z.object({
  employeeId: z.string().min(1),
  totalAmount: z.number().positive(),
  reason: z.string().trim().min(1, "Contá el motivo."),
  evidenceUrl: z.string().optional(),
  installments: z.number().int().min(1),
  startMonth: z.string().regex(/^\d{4}-\d{2}$/),
});

// Confirmado 2026-08-18: solo el admin ingresa esto — el colaborador
// afectado tiene que aceptarlo explícitamente antes de que se aplique a
// ningún rol (ver /[id]/accept).
export async function POST(req: NextRequest) {
  if (!(await canCreateManagementDeduction())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const deduction = await prisma.managementDeduction.create({ data: parsed.data });

  await sendPushToOwner(parsed.data.employeeId, {
    title: "⚠️ Descuento por confirmar",
    body: `$${parsed.data.totalAmount.toFixed(2)} — ${parsed.data.reason}`,
    url: "/area/roles-de-pago",
  }).catch(() => null);

  return NextResponse.json(deduction, { status: 201 });
}
