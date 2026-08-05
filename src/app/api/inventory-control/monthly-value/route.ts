import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canManageInventoryControl } from "@/lib/guards";
import { getFinanzasDeptId, currentPeriod } from "@/lib/inventoryKpis";
import { prisma } from "@/lib/prisma";

const schema = z.object({ value: z.number().nonnegative() });

// Daniel (líder de Inventario) carga el único dato mensual que le
// corresponde — confirmado 2026-08-04: escribe directo en el mismo
// FinanceSharedMonthlyBalance.inventarioFinal que ya usa "Cargar plantilla",
// solo que desde su propia pantalla ("Control de Inventario" en Mi área de
// trabajo) en vez de la de Finanzas.
export async function POST(req: NextRequest) {
  if (!(await canManageInventoryControl())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Valor inválido." }, { status: 400 });

  const deptId = await getFinanzasDeptId();
  if (!deptId) return NextResponse.json({ error: "No se encontró el departamento de Finanzas." }, { status: 500 });

  const period = currentPeriod();
  await prisma.financeSharedMonthlyBalance.upsert({
    where: { deptId_period: { deptId, period } },
    create: { deptId, period, inventarioFinal: parsed.data.value },
    update: { inventarioFinal: parsed.data.value },
  });

  return NextResponse.json({ ok: true, period });
}
