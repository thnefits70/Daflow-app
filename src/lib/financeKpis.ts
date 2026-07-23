import { prisma } from "@/lib/prisma";
import type { FinanceMonthRaw } from "@/lib/financeKpisCalc";

export type FinanceOperationDTO = { id: string; name: string; isActive: boolean };

export type FinanceSharedBalanceDTO = {
  period: string;
  inventarioFinal: number | null;
  cuentasPorCobrar: number | null;
  cuentasPorPagar: number | null;
};

export type FinanceUploadDTO = {
  period: string;
  uploadedByName: string | null;
  createdAt: string;
  isCorrection: boolean;
};

export type FinanceKpiSettingsDTO = {
  targetMargenBruto: number;
  targetMargenOperativo: number;
  targetMargenNeto: number;
  excelenteMargenNeto: number;
  roiBandRed: number;
  roiBandYellow: number;
  roiBandTarget: number;
  roiBandExcellent: number;
  taxRatePct: number;
};

export type FinanceKpiDataDTO = {
  deptId: string;
  operations: FinanceOperationDTO[];
  recordsByOperation: Record<string, FinanceMonthRaw[]>;
  sharedBalances: FinanceSharedBalanceDTO[];
  uploads: FinanceUploadDTO[];
  settings: FinanceKpiSettingsDTO;
};

const DEFAULT_SETTINGS: FinanceKpiSettingsDTO = {
  targetMargenBruto: 35,
  targetMargenOperativo: 15,
  targetMargenNeto: 20,
  excelenteMargenNeto: 30,
  roiBandRed: 15,
  roiBandYellow: 20,
  roiBandTarget: 20,
  roiBandExcellent: 45,
  taxRatePct: 25,
};

// Everything the "KPIs financieros" dashboard needs, assembled server-side
// in one pass and handed to the client as plain serializable data — the
// client component then does all filtering/recomputation locally (brand
// toggle, period comparison, granularity) exactly like the approved boceto,
// with no extra round-trip per filter change.
export async function getFinanceKpiData(deptId: string): Promise<FinanceKpiDataDTO> {
  const [operations, records, sharedBalances, uploads, settings] = await Promise.all([
    prisma.financeOperation.findMany({ where: { deptId }, orderBy: { order: "asc" } }),
    prisma.financeKpiRecord.findMany({ where: { deptId }, orderBy: { period: "asc" } }),
    prisma.financeSharedMonthlyBalance.findMany({ where: { deptId }, orderBy: { period: "asc" } }),
    prisma.financeKpiUpload.findMany({
      where: { deptId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { uploadedBy: { select: { name: true } } },
    }),
    prisma.financeKpiSettings.findUnique({ where: { deptId } }),
  ]);

  const recordsByOperation: Record<string, FinanceMonthRaw[]> = {};
  for (const op of operations) recordsByOperation[op.id] = [];
  for (const r of records) {
    (recordsByOperation[r.operationId] ??= []).push({
      period: r.period,
      ventas: r.ventas,
      costoVentas: r.costoVentas,
      gastosVenta: r.gastosVenta,
      gastosAdmin: r.gastosAdmin,
      otrosIngresos: r.otrosIngresos,
      gastosFinancieros: r.gastosFinancieros,
      otrosGastos: r.otrosGastos,
      roi: r.roi,
    });
  }

  return {
    deptId,
    operations: operations.map((o) => ({ id: o.id, name: o.name, isActive: o.isActive })),
    recordsByOperation,
    sharedBalances: sharedBalances.map((b) => ({
      period: b.period,
      inventarioFinal: b.inventarioFinal,
      cuentasPorCobrar: b.cuentasPorCobrar,
      cuentasPorPagar: b.cuentasPorPagar,
    })),
    uploads: uploads.map((u) => ({
      period: u.period,
      uploadedByName: u.uploadedBy?.name ?? null,
      createdAt: u.createdAt.toISOString(),
      isCorrection: u.isCorrection,
    })),
    settings: settings
      ? {
          targetMargenBruto: settings.targetMargenBruto,
          targetMargenOperativo: settings.targetMargenOperativo,
          targetMargenNeto: settings.targetMargenNeto,
          excelenteMargenNeto: settings.excelenteMargenNeto,
          roiBandRed: settings.roiBandRed,
          roiBandYellow: settings.roiBandYellow,
          roiBandTarget: settings.roiBandTarget,
          roiBandExcellent: settings.roiBandExcellent,
          taxRatePct: settings.taxRatePct,
        }
      : DEFAULT_SETTINGS,
  };
}
