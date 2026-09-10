import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManageInventoryControl } from "@/lib/guards";
import { getFinanzasDeptId, recentInventorySnapshotPeriods } from "@/lib/inventoryKpis";
import { prisma } from "@/lib/prisma";
import { computeAndSaveStockComparison } from "@/lib/stockKardexComparison";
import { countSeedableFromJustSnapshot } from "@/lib/stockKardex";

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

  // Confirmado 2026-09-10 (reportado por Daniel): si por algún motivo llega
  // un código repetido hasta acá (normalmente ya se filtra en el parseo),
  // esto evita que choque contra la restricción de código único por semana
  // y tumbe el guardado sin explicación — se queda con la última ocurrencia.
  const dedupedRows = [...new Map(rows.map((r) => [r.productCode, r])).values()];

  try {
    await prisma.$transaction([
      prisma.inventoryProductSnapshot.deleteMany({ where: { deptId, period } }),
      prisma.inventoryProductSnapshot.createMany({
        data: dedupedRows.map((r) => ({
          deptId, period,
          productCode: r.productCode, description: r.description, avgCost: r.avgCost, stock: r.stock, costTotal: r.costTotal,
          createdById,
        })),
      }),
    ]);
  } catch (err) {
    console.error("[stock-snapshot save] No se pudo guardar:", err);
    return NextResponse.json({ error: "No se pudo guardar — revisa el archivo e intenta de nuevo." }, { status: 500 });
  }

  // Confirmado 2026-09-09 (Fase 3, INVESTOCK): mismo momento donde ya se
  // guarda el export de Just — de una vez se compara contra el número que
  // INVESTOCK calculó por su cuenta, sin tocar nada del flujo que Daniel ya
  // conoce.
  const comparison = await computeAndSaveStockComparison(deptId, period).catch((err) => {
    console.error("[stock-snapshot save] No se pudo calcular la comparación INVESTOCK:", err);
    return [];
  });

  // Confirmado 2026-09-10 (pedido explícito del usuario): "saldo inicial de
  // INVESTOCK" — solo cuenta acá (no escribe nada), para que la pantalla
  // muestre el botón solo si de verdad hay algo pendiente de cargar.
  const seedableCount = await countSeedableFromJustSnapshot(
    dedupedRows.map((r) => ({ productCode: r.productCode, avgCost: r.avgCost, stock: r.stock }))
  ).catch((err) => {
    console.error("[stock-snapshot save] No se pudo calcular el conteo de saldo inicial:", err);
    return 0;
  });

  return NextResponse.json({ ok: true, period, count: dedupedRows.length, comparison, seedableCount });
}
