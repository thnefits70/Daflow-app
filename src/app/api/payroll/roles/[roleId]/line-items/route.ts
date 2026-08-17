import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canEditPayrollRoles } from "@/lib/guards";
import { totalsFromLineItems } from "@/lib/payroll";

const schema = z.object({
  lineItems: z
    .array(
      z.object({
        label: z.string().trim().min(1),
        amount: z.number().positive(),
        kind: z.enum(["INCOME", "EXPENSE"]),
        isAutomatic: z.boolean().optional(),
        note: z.string().optional(),
      })
    )
    .min(1),
});

// Confirmado 2026-08-13: reemplaza TODA la lista de conceptos de este rol —
// mismo patrón que ya usa PurchaseRequest al reenviar (borrar+recrear) —
// solo mientras el período siga en borrador, nunca en uno ya publicado (ver
// /roles/[roleId]/correct para corregir uno publicado).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ roleId: string }> }) {
  if (!(await canEditPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { roleId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const role = await prisma.payrollQuincenaRole.findUnique({ where: { id: roleId }, include: { period: true } });
  if (!role) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (role.period.status !== "DRAFT") {
    return NextResponse.json({ error: "Este período ya fue publicado — usá la corrección en vez de editar directo." }, { status: 409 });
  }

  const totals = totalsFromLineItems(parsed.data.lineItems);
  await prisma.$transaction([
    prisma.payrollLineItem.deleteMany({ where: { roleId } }),
    prisma.payrollQuincenaRole.update({
      where: { id: roleId },
      data: { ...totals, lineItems: { create: parsed.data.lineItems.map((i) => ({ ...i, isAutomatic: i.isAutomatic ?? false })) } },
    }),
  ]);

  const updated = await prisma.payrollQuincenaRole.findUnique({ where: { id: roleId }, include: { lineItems: true } });
  return NextResponse.json(updated);
}
