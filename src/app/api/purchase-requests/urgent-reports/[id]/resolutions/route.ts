import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";
import { totalReportedQty, claimedQty } from "@/lib/purchaseUrgent";

const schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CREDIT"), quantity: z.number().int().positive() }),
  z.object({ type: z.literal("REPLACEMENT"), quantity: z.number().int().positive(), dueDate: z.string() }),
  z.object({ type: z.literal("REFUND"), quantity: z.number().int().positive() }),
  z.object({ type: z.literal("WRITE_OFF"), quantity: z.number().int().positive(), note: z.string().trim().min(1, "Explica por qué no se recupera.") }),
]);

// Confirmado 2026-08-06: Bryan (o admin) reparte la cantidad reportada por
// Daniel entre uno o varios caminos — el monto de cada resolución SIEMPRE
// sale de quantity × unitCost de la cotización original, nunca un valor
// escrito a mano (evita inflar el reclamo). Puede dividir el reporte (ej.
// 10 un. con crédito, 20 con reembolso) mientras no reclame más de lo que
// queda sin asignar.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const isAdmin = session?.user.role === "admin";
  if (!session || (!isAdmin && !(await canSubmitPurchaseRequests()))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const report = await prisma.purchaseRequestUrgentReport.findUnique({
    where: { id },
    include: {
      resolutions: { select: { quantity: true, status: true } },
      request: { select: { unitCost: true, supplierId: true, catalogItem: { select: { name: true } } } },
    },
  });
  if (!report) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const remaining = totalReportedQty(report) - claimedQty(report.resolutions);
  if (parsed.data.quantity > remaining) {
    return NextResponse.json({ error: `Solo quedan ${remaining} un. sin resolver en este reporte.` }, { status: 409 });
  }

  const amount = parsed.data.quantity * report.request.unitCost;
  const createdById = isAdmin ? null : session.user.id;

  const resolution = await prisma.$transaction(async (tx) => {
    if (parsed.data.type === "CREDIT") {
      const res = await tx.purchaseUrgentResolution.create({
        data: { reportId: id, type: "CREDIT", quantity: parsed.data.quantity, amount, status: "COMPLETED", createdById },
      });
      await tx.supplierCredit.create({
        data: {
          supplierId: report.request.supplierId,
          amount,
          reason: `Reporte urgente — ${report.request.catalogItem.name} (${parsed.data.quantity} un.)`,
          urgentResolutionId: res.id,
          status: "AVAILABLE",
          createdById,
        },
      });
      return res;
    }
    if (parsed.data.type === "REPLACEMENT") {
      return tx.purchaseUrgentResolution.create({
        data: { reportId: id, type: "REPLACEMENT", quantity: parsed.data.quantity, amount, status: "PENDING", replacementDueDate: new Date(parsed.data.dueDate), createdById },
      });
    }
    if (parsed.data.type === "REFUND") {
      return tx.purchaseUrgentResolution.create({
        data: { reportId: id, type: "REFUND", quantity: parsed.data.quantity, amount, status: "PENDING", createdById },
      });
    }
    return tx.purchaseUrgentResolution.create({
      data: { reportId: id, type: "WRITE_OFF", quantity: parsed.data.quantity, amount, status: "COMPLETED", note: parsed.data.note, createdById },
    });
  });

  if (parsed.data.type === "REPLACEMENT") {
    const invLeader = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "INV" } }, select: { id: true } });
    if (invLeader) {
      await sendPushToOwner(invLeader.id, {
        title: "📦 Cambio de mercadería pendiente de verificar",
        body: `${report.request.catalogItem.name} — ${parsed.data.quantity} un. · llega hasta ${new Date(parsed.data.dueDate).toLocaleDateString("es-MX")}`,
        url: "/area/workspace",
      }).catch(() => null);
    }
  }

  return NextResponse.json(resolution, { status: 201 });
}
