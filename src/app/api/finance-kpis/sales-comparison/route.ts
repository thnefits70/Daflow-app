import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canEditDeptKpis } from "@/lib/guards";
import { getAutoSalesEstimateByMonth, type MarcaBucketKey } from "@/lib/inventorySalesEstimate";

const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

// Confirmado 2026-09-17, pedido explícito del usuario: Nairoby sube su
// plantilla de KPIs Financieros separada por operación (Provedix/Importadora
// Damián/Importadora Shanghai) — mismos nombres que las 3 marcas del
// catálogo (bodega), así que el estimado automático se puede repartir igual.
// Coincidencia por nombre porque FinanceOperation no tiene un campo propio
// que la ligue directo al enum MarketProductBodega.
function marcaForOperationName(name: string): MarcaBucketKey | null {
  const n = name.trim().toLowerCase();
  if (n.includes("provedix")) return "MKT_PROVEDIX";
  if (n.includes("damián") || n.includes("damian")) return "MKT_DAMIAN";
  if (n.includes("shanghai")) return "MKT_SHANGHAI";
  return null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const deptId = searchParams.get("deptId");
  const period = searchParams.get("period");
  if (!deptId || !period || !PERIOD_REGEX.test(period)) {
    return NextResponse.json({ error: "Parámetros inválidos." }, { status: 400 });
  }
  if (!(await canEditDeptKpis(deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const [operations, records, autoByMonth] = await Promise.all([
    prisma.financeOperation.findMany({ where: { deptId, isActive: true }, orderBy: { order: "asc" } }),
    prisma.financeKpiRecord.findMany({ where: { deptId, period } }),
    getAutoSalesEstimateByMonth([period]),
  ]);
  const recordByOpId = new Map(records.map((r) => [r.operationId, r]));
  const autoRow = autoByMonth.get(period) ?? null;

  const rows = operations.map((op) => {
    const marca = marcaForOperationName(op.name);
    const record = recordByOpId.get(op.id);
    return {
      operationId: op.id,
      operationName: op.name,
      nairoby: record ? { ventas: record.ventas, costoVentas: record.costoVentas } : null,
      auto: marca && autoRow ? autoRow[marca] : null,
    };
  });

  return NextResponse.json({ rows, sinMarca: autoRow?.SIN_MARCA ?? null });
}
