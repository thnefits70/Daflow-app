import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManageInventoryControl } from "@/lib/guards";
import { getFinanzasDeptId, recentInventorySnapshotPeriods } from "@/lib/inventoryKpis";
import { prisma } from "@/lib/prisma";

const rowSchema = z.object({
  productCode: z.string().trim().min(1),
  description: z.string(),
  avgCost: z.number(),
  stock: z.number(),
  costTotal: z.number(),
});

const schema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}-W[1-4]$/),
  rows: z.array(rowSchema).min(1),
});

// Confirmado 2026-08-05 (cadencia cambiada a semanal el 2026-08-25):
// reemplaza por completo la semana, no hace merge fila por fila — mismo
// criterio que "reemplazar" en la plantilla de Finanzas. Si Daniel corrige
// un error, vuelve a subir el Excel completo de esa semana.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canManageInventoryControl()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const { period, rows } = parsed.data;
  if (!recentInventorySnapshotPeriods().includes(period)) {
    return NextResponse.json({ error: "Esa semana no está disponible para cargar." }, { status: 400 });
  }

  const deptId = await getFinanzasDeptId();
  if (!deptId) return NextResponse.json({ error: "No se encontró el departamento de Finanzas." }, { status: 500 });

  const createdById = session.user.role === "admin" ? null : session.user.id;

  await prisma.$transaction([
    prisma.inventoryProductSnapshot.deleteMany({ where: { deptId, period } }),
    prisma.inventoryProductSnapshot.createMany({
      data: rows.map((r) => ({
        deptId, period,
        productCode: r.productCode, description: r.description, avgCost: r.avgCost, stock: r.stock, costTotal: r.costTotal,
        createdById,
      })),
    }),
  ]);

  return NextResponse.json({ ok: true, period, count: rows.length });
}
