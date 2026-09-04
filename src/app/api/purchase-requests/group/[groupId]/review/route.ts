import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { sendPushToOwner } from "@/lib/webPush";
import { releaseCreditsForGroup, getReservedCreditsForGroup } from "@/lib/supplierCredits";
import { canActOnPurchaseApproval } from "@/lib/guards";
import { reviewApprovedPurchaseGroup } from "@/lib/purchaseAi";

const schema = z.object({ action: z.enum(["approve", "reject"]), rejectReason: z.string().trim().optional() });

// Confirmado 2026-07-31: una cotización con varios productos se aprueba o
// rechaza COMO UNA SOLA compra — aplica a todas las filas del groupId a la
// vez, no producto por producto.
// Confirmado 2026-09-02: pedido explícito del usuario — corrección al
// diseño anterior. Aprobar/rechazar es EXCLUSIVO de quien tenga el permiso
// (hoy Bryan), ni siquiera admin — su parte activa pasó a ser pagar, no
// aprobar (ver canActOnPurchaseApproval en guards.ts).
// Confirmado 2026-09-03: EXCEPCIÓN a lo anterior — un grupo isEmergency
// (vía de respaldo cuando Jariel/Nairoby no están disponibles, ver
// canSubmitEmergencyPurchaseRequest) solo lo puede aprobar/rechazar el
// admin, nunca quien tenga el flag normal (hoy Bryan) — justamente porque
// Bryan podría ser quien la subió, y no debe poder aprobarse a sí mismo.
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const rows = await prisma.purchaseRequest.findMany({
    where: { groupId },
    include: {
      catalogItem: { select: { name: true, justCode: true } },
      supplier: { select: { name: true } },
      bankAccount: { select: { bankName: true, bankAccountType: true, bankAccountNumber: true, bankAccountHolder: true } },
    },
  });
  if (rows.length === 0) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (rows.some((r) => r.status !== "PENDING_APPROVAL")) return NextResponse.json({ error: "Ya fue revisada." }, { status: 409 });

  const isEmergencyGroup = rows.some((r) => r.isEmergency);
  const authorized = isEmergencyGroup ? session.user.role === "admin" : await canActOnPurchaseApproval();
  if (!authorized) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  // Confirmado 2026-09-02: pedido explícito del usuario — antes reviewedById
  // se dejaba siempre en null; ahora sí registra a quien aprobó de verdad
  // (Bryan) para que "Aprobada por X" en Mis solicitudes/Auditoría muestre a
  // la persona correcta. El admin (login "admin", sin fila real en User)
  // sigue guardando null, mismo patrón que paidById en pay/route.ts.
  const isAdmin = session.user.role === "admin";
  const actorId = isAdmin ? null : session.user.id;
  await prisma.purchaseRequest.updateMany({
    where: { groupId },
    data:
      parsed.data.action === "approve"
        ? { status: "APPROVED", reviewedById: actorId, reviewedAt: new Date() }
        : { status: "REJECTED", rejectReason: parsed.data.rejectReason, reviewedById: actorId, reviewedAt: new Date() },
  });

  // Confirmado 2026-08-12: pedido explícito del usuario — si se rechaza por
  // completo, cualquier crédito reservado para esta solicitud vuelve a
  // quedar libre de inmediato.
  if (parsed.data.action === "reject") {
    await releaseCreditsForGroup(groupId);
  }

  const names = rows.map((r) => r.catalogItem.name).join(", ");

  const requestedById = rows[0].requestedById;
  if (requestedById) {
    await sendPushToOwner(requestedById, {
      title: parsed.data.action === "approve" ? "Solicitud aprobada" : "Solicitud rechazada",
      body: `${names} — ${parsed.data.action === "approve" ? "sigue con el pago" : parsed.data.rejectReason || "sin motivo especificado"}`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  // Confirmado 2026-09-03: pedido explícito del usuario — avisar al admin
  // al instante cuando se aprueba (antes solo se enteraba por la tarjeta de
  // Inicio o, si nadie pagaba, por el aviso tardío de 24h en el cron).
  if (parsed.data.action === "approve" && !isAdmin) {
    await sendPushToOwner("admin", {
      title: "Solicitud de compra aprobada",
      body: `${names} — lista para pagar`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  // Confirmado 2026-09-04: pedido explícito del usuario (admin/Andrés) — en
  // cuanto se aprueba, la IA revisa de una sola vez toda la operación
  // (precios, crédito, documentos, cuenta bancaria) para que admin no tenga
  // que entrar a revisar cada solicitud a mano antes de pagar. Nunca bloquea
  // la aprobación en sí — si la IA falla, la solicitud queda igual aprobada,
  // simplemente sin resumen (se reintenta solo/a mano más adelante).
  if (parsed.data.action === "approve") {
    try {
      const reservedCredits = await getReservedCreditsForGroup(groupId);
      const r0 = rows[0];
      const review = await reviewApprovedPurchaseGroup({
        actorId,
        deptId: r0.deptId,
        supplierName: r0.supplier.name,
        requestNumber: r0.requestNumber,
        lines: rows.map((r) => ({
          name: r.catalogItem.name,
          justCode: r.catalogItem.justCode,
          quantity: r.quantity,
          unitCost: r.unitCost,
          totalCost: r.totalCost,
          justification: r.justification,
        })),
        totalCost: rows.reduce((s, r) => s + r.totalCost, 0),
        quoteReadTotal: r0.quoteReadTotal,
        quoteReferenceCode: r0.quoteReferenceCode,
        hasPurchaseOrder: !!r0.purchaseOrderUrl,
        bankAccount: r0.bankAccount,
        reservedCreditTotal: reservedCredits.reduce((s, c) => s + c.amount, 0),
        creditSkipJustification: r0.creditSkipJustification,
      });
      await prisma.purchaseRequest.updateMany({
        where: { groupId },
        data: { aiReviewSummary: review.summary, aiReviewOk: review.ok, aiReviewAt: new Date() },
      });
    } catch {
      // Sin bloquear — ver comentario arriba.
    }
  }

  const updated = await prisma.purchaseRequest.findMany({ where: { groupId } });
  return NextResponse.json(updated);
}
