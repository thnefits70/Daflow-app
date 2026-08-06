import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("credit"), amount: z.number().positive(), reason: z.string().trim().min(1) }),
  z.object({ action: z.literal("refund"), amount: z.number().positive(), reason: z.string().trim().min(1), refundProofUrl: z.string().url() }),
  z.object({ action: z.literal("none"), reason: z.string().trim().min(1) }),
]);

// Confirmado 2026-08-06: cómo se cierra un "Informe urgente" con el
// proveedor — "credit" deja un SupplierCredit AVAILABLE para aplicar a la
// siguiente compra a ese proveedor, "refund" registra que ya reembolsó en
// efectivo/transferencia (con comprobante), "none" solo cierra el reporte
// con una nota (ej. el proveedor no aceptó reclamo, o se resolvió de otra
// forma que no involucra dinero).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const report = await prisma.purchaseRequestUrgentReport.findUnique({
    where: { id },
    include: { request: { select: { supplierId: true } }, credit: true },
  });
  if (!report) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (report.resolvedAt) return NextResponse.json({ error: "Este reporte ya fue resuelto." }, { status: 409 });

  const data = parsed.data;
  await prisma.$transaction(async (tx) => {
    await tx.purchaseRequestUrgentReport.update({
      where: { id },
      data: { resolvedAt: new Date(), resolution: data.reason },
    });
    if (data.action === "credit") {
      await tx.supplierCredit.create({
        data: {
          supplierId: report.request.supplierId,
          amount: data.amount,
          reason: data.reason,
          urgentReportId: id,
          status: "AVAILABLE",
          createdById: null,
        },
      });
    } else if (data.action === "refund") {
      await tx.supplierCredit.create({
        data: {
          supplierId: report.request.supplierId,
          amount: data.amount,
          reason: data.reason,
          urgentReportId: id,
          status: "REFUNDED",
          refundProofUrl: data.refundProofUrl,
          refundedAt: new Date(),
          createdById: null,
        },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
