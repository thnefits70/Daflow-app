import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { nothingArrivedUnpaid } from "@/lib/purchaseCancelNotSent";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { totalReportedQty, claimedQty } from "@/lib/purchaseUrgent";
import { checkClaimProofForSave } from "@/lib/claimProofCheck";

const schema = z.discriminatedUnion("type", [
  // Confirmado 2026-08-25: pedido explícito del usuario — el comprobante que
  // manda el proveedor (chat, correo, nota de crédito) queda adjunto al
  // crédito desde que se registra, para trazabilidad de punta a punta —
  // mismo campo (SupplierCredit.proofUrl/proofName) que ya usan los créditos
  // manuales, ahora también en los automáticos que salen de un reporte.
  // Confirmado 2026-09-29: la IA revisa la captura antes de guardar (ver
  // claimProofCheck.ts) — la lectura firmada y, si no cuadra, la explicación.
  z.object({
    type: z.literal("CREDIT"),
    quantity: z.number().int().positive(),
    proofUrl: z.string().url("Sube el comprobante del proveedor."),
    proofName: z.string().trim().optional(),
    proofRead: z.unknown().optional(),
    proofSignature: z.string().optional(),
    proofMismatchNote: z.string().optional(),
  }),
  z.object({ type: z.literal("REPLACEMENT"), quantity: z.number().int().positive(), dueDate: z.string(), missingDelivery: z.boolean().optional() }),
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
      resolutions: { select: { quantity: true, status: true, type: true } },
      request: {
        select: {
          unitCost: true,
          supplierId: true,
          catalogItem: { select: { name: true } },
          supplier: { select: { name: true, paymentMode: true } },
          quantity: true,
          paidAt: true,
          debtPaymentId: true,
          receipt: { select: { id: true } },
          urgentReports: {
            select: {
              rejectedAt: true,
              isLateClaim: true,
              damagedQty: true,
              incompleteQty: true,
              differentQty: true,
              missingQty: true,
              excessQty: true,
              resolutions: { select: { status: true } },
            },
          },
        },
      },
    },
  });
  if (!report) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  // Un "Reclamo posterior al cierre" solo se puede gestionar con el
  // proveedor una vez aprobado y descontado de INVESTOCK (justConfirmedAt,
  // automático desde 2026-09-23) — la UI ya no lo ofrece antes de eso (ver
  // el filtro en urgent-reports/route.ts), esto es la validación real.
  if (report.isLateClaim && !report.justConfirmedAt) {
    return NextResponse.json({ error: "Este reclamo todavía no fue aprobado por Daniel." }, { status: 409 });
  }

  const remaining = totalReportedQty(report) - claimedQty(report.resolutions);
  if (parsed.data.quantity > remaining) {
    return NextResponse.json({ error: `Solo quedan ${remaining} un. sin resolver en este reporte.` }, { status: 409 });
  }

  // Pedido del usuario 2026-10-10 (SC-118): si no llegó nada y no se pagó
  // nada, solo cabe que el proveedor lo envíe otro día — o cancelar la
  // compra (cancel-not-sent). Ver nothingArrivedUnpaid.
  if (!report.isLateClaim && nothingArrivedUnpaid(report.request)) {
    const isMissingDelivery = parsed.data.type === "REPLACEMENT" && parsed.data.missingDelivery === true;
    if (!isMissingDelivery) {
      return NextResponse.json(
        { error: 'No llegó ninguna unidad y no se pagó nada: solo cabe "Entrega de mercadería faltante". Si el proveedor no la va a enviar, usa "Cancelar compra".' },
        { status: 409 }
      );
    }
  }

  // Confirmado 2026-09-29, pedido del usuario (antifraude): "Pérdida" hace
  // que el proveedor de crédito cobre el 100% aunque la mercadería nunca
  // llegó. Con un proveedor de CRÉDITO (hoy CHEN) no se puede usar para
  // unidades FALTANTES — ahí solo va "Crédito futuro" o "Entrega de
  // faltante". Solo cabe para lo dañado/incompleto/distinto que sí llegó.
  if (parsed.data.type === "WRITE_OFF" && report.request.supplier.paymentMode === "CREDITO") {
    const nonMissing = report.damagedQty + report.incompleteQty + report.differentQty;
    const writeOffUsed = report.resolutions.filter((r) => r.type === "WRITE_OFF" && r.status !== "CANCELLED").reduce((s, r) => s + r.quantity, 0);
    const allowed = Math.max(0, nonMissing - writeOffUsed);
    if (allowed === 0) {
      return NextResponse.json({ error: `A ${report.request.supplier.name} (proveedor a crédito) no se le puede declarar "Pérdida" por mercadería faltante — si no la va a mandar, usa "No se paga (se descuenta en la tanda)".` }, { status: 409 });
    }
    if (parsed.data.quantity > allowed) {
      return NextResponse.json({ error: `Con un proveedor a crédito, "Pérdida" solo cabe para lo dañado, incompleto o distinto (máximo ${allowed} un.). Lo faltante va con "No se paga (se descuenta en la tanda)".` }, { status: 409 });
    }
  }
  // Nunca la misma persona en los dos pasos: quien reportó o confirmó el
  // problema en bodega no puede ser quien declara la pérdida.
  if (parsed.data.type === "WRITE_OFF" && !isAdmin && (report.reportedById === session.user.id || report.reviewedByLeadId === session.user.id)) {
    return NextResponse.json({ error: "Tú reportaste o confirmaste este problema en bodega — la pérdida la tiene que pedir otra persona de Compras." }, { status: 403 });
  }

  // Confirmado 2026-08-25: un "Reclamo posterior al cierre" con origen
  // incierto usa el costo promedio (estimatedUnitCost) en vez del unitCost
  // puntual de la solicitud elegida — mismo criterio que ya se le mostró a
  // Inventario al reportar.
  let proofCheck: Awaited<ReturnType<typeof checkClaimProofForSave>> | null = null;
  if (parsed.data.type === "CREDIT") {
    proofCheck = await checkClaimProofForSave({
      target: { kind: "no_envio", reportId: id, quantity: parsed.data.quantity },
      proofUrl: parsed.data.proofUrl,
      input: { read: parsed.data.proofRead, signature: parsed.data.proofSignature, mismatchNote: parsed.data.proofMismatchNote },
    });
    if (!proofCheck.ok) return NextResponse.json({ error: proofCheck.error }, { status: 400 });
  }

  const effectiveUnitCost = report.isLateClaim && report.originUncertain && report.estimatedUnitCost != null ? report.estimatedUnitCost : report.request.unitCost;
  const amount = parsed.data.quantity * effectiveUnitCost;
  const createdById = isAdmin ? null : session.user.id;

  let resolution;
  try {
    resolution = await prisma.$transaction(async (tx) => {
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
            proofUrl: parsed.data.proofUrl,
            proofName: parsed.data.proofName || null,
            proofHash: proofCheck?.ok ? proofCheck.proofHash : null,
            proofAiCheck: proofCheck?.ok && proofCheck.read ? JSON.parse(JSON.stringify(proofCheck.read)) : undefined,
            proofMismatchNote: proofCheck?.ok ? proofCheck.mismatchNote : null,
          },
        });
        return res;
      }
      if (parsed.data.type === "REPLACEMENT") {
        return tx.purchaseUrgentResolution.create({
          data: { reportId: id, type: "REPLACEMENT", quantity: parsed.data.quantity, amount, status: "PENDING", replacementDueDate: new Date(parsed.data.dueDate), replacementIsMissingDelivery: parsed.data.missingDelivery ?? false, createdById },
        });
      }
      if (parsed.data.type === "REFUND") {
        return tx.purchaseUrgentResolution.create({
          data: { reportId: id, type: "REFUND", quantity: parsed.data.quantity, amount, status: "PENDING", createdById },
        });
      }
      // Confirmado 2026-09-29 (antifraude): una pérdida que pide Compras
      // queda PENDING hasta que el admin la apruebe (ver
      // urgent-resolutions/[id]/review-write-off) — mientras tanto el
      // reporte sigue abierto y el pedido no se paga. Solo la del admin
      // queda cerrada de una.
      return tx.purchaseUrgentResolution.create({
        data: { reportId: id, type: "WRITE_OFF", quantity: parsed.data.quantity, amount, status: isAdmin ? "COMPLETED" : "PENDING", note: parsed.data.note, createdById },
      });
    });
  } catch (err) {
    console.error("[urgent-reports resolutions] falló al crear la resolución", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `No se pudo registrar: ${message}` }, { status: 500 });
  }

  if (proofCheck?.ok && proofCheck.mismatchNote && !isAdmin) {
    await notifyOwner("admin", {
      title: "⚠️ Captura que no cuadra",
      body: `${report.request.catalogItem.name} (${report.request.supplier.name}) — ${parsed.data.quantity} un. sin pagar · $${amount.toFixed(2)}. ${proofCheck.mismatchNote}`,
      url: "/admin",
    }).catch(() => null);
  }

  if (parsed.data.type === "WRITE_OFF" && !isAdmin) {
    await notifyOwner("admin", {
      title: "⚠️ Pérdida por aprobar",
      body: `${report.request.catalogItem.name} (${report.request.supplier.name}) — ${parsed.data.quantity} un. · $${amount.toFixed(2)} · pedida por ${session.user.name ?? "Compras"}: "${parsed.data.note}"`,
      url: "/admin",
    }).catch(() => null);
  }

  if (parsed.data.type === "REPLACEMENT") {
    const invLeader = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "INV" } }, select: { id: true } });
    if (invLeader) {
      const isMissingDelivery = parsed.data.missingDelivery ?? false;
      await notifyOwner(invLeader.id, {
        title: isMissingDelivery ? "📦 Entrega de mercadería faltante pendiente de verificar" : "📦 Cambio de mercadería pendiente de verificar",
        body: `${report.request.catalogItem.name} — ${parsed.data.quantity} un. · llega hasta ${new Date(parsed.data.dueDate).toLocaleDateString("es-MX")}`,
        url: "/area/workspace",
      });
    }
  }

  return NextResponse.json(resolution, { status: 201 });
}
