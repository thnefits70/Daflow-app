import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEditDeptKpis } from "@/lib/guards";

const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

const rowSchema = z.object({
  operationId: z.string().min(1),
  ventas: z.number(),
  costoVentas: z.number(),
  gastosVenta: z.number(),
  gastosAdmin: z.number(),
  otrosIngresos: z.number(),
  gastosFinancieros: z.number(),
  otrosGastos: z.number(),
  roi: z.number().nullable().optional(),
});

const saveSchema = z
  .object({
    deptId: z.string().min(1),
    period: z.string().regex(PERIOD_REGEX, "Formato de mes inválido."),
    // Allowed to be empty when this call is only updating the shared
    // balances (inventario/cartera/proveedores) — those aren't tied to a
    // single operación, so a manual "solo saldos compartidos" save is valid.
    rows: z.array(rowSchema),
    shared: z
      .object({
        inventarioFinal: z.number().nullable().optional(),
        cuentasPorCobrar: z.number().nullable().optional(),
        cuentasPorPagar: z.number().nullable().optional(),
      })
      .nullable()
      .optional(),
    fileUrl: z.string().nullable().optional(),
    fileName: z.string().nullable().optional(),
  })
  .refine((v) => v.rows.length > 0 || !!v.shared, {
    message: "Debes incluir al menos una operación o los saldos compartidos.",
  });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const { deptId, period, rows, shared, fileUrl, fileName } = parsed.data;

  if (!(await canEditDeptKpis(deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  // Confirm every operationId actually belongs to this department, so a
  // crafted request can't write records against another dept's operations.
  const operations = await prisma.financeOperation.findMany({
    where: { id: { in: rows.map((r) => r.operationId) }, deptId },
    select: { id: true },
  });
  const validOpIds = new Set(operations.map((o) => o.id));
  if (rows.some((r) => !validOpIds.has(r.operationId))) {
    return NextResponse.json({ error: "Una o más operaciones no pertenecen a este departamento." }, { status: 400 });
  }

  const session = await auth();
  const uploadedById = session?.user.role === "admin" ? null : (session?.user.id ?? null);

  const existingCount = await prisma.financeKpiRecord.count({ where: { deptId, period } });
  const isCorrection = existingCount > 0;

  await prisma.$transaction([
    ...rows.map((r) =>
      prisma.financeKpiRecord.upsert({
        where: { operationId_period: { operationId: r.operationId, period } },
        update: {
          ventas: r.ventas, costoVentas: r.costoVentas, gastosVenta: r.gastosVenta, gastosAdmin: r.gastosAdmin,
          otrosIngresos: r.otrosIngresos, gastosFinancieros: r.gastosFinancieros, otrosGastos: r.otrosGastos,
          roi: r.roi ?? null, uploadedById,
        },
        create: {
          deptId, operationId: r.operationId, period,
          ventas: r.ventas, costoVentas: r.costoVentas, gastosVenta: r.gastosVenta, gastosAdmin: r.gastosAdmin,
          otrosIngresos: r.otrosIngresos, gastosFinancieros: r.gastosFinancieros, otrosGastos: r.otrosGastos,
          roi: r.roi ?? null, uploadedById,
        },
      })
    ),
    ...(shared
      ? [
          prisma.financeSharedMonthlyBalance.upsert({
            where: { deptId_period: { deptId, period } },
            update: shared,
            create: { deptId, period, ...shared },
          }),
        ]
      : []),
    prisma.financeKpiUpload.create({
      data: { deptId, period, uploadedById, fileUrl: fileUrl ?? null, fileName: fileName ?? null, isCorrection },
    }),
  ]);

  return NextResponse.json({ ok: true, isCorrection });
}
