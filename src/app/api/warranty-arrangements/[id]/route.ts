import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { arrangementCode, arrangementNotices, getArrangementRole } from "@/lib/warrantyArrangements";

const schema = z.discriminatedUnion("action", [
  // Admin: el pago del flete del dropshipper llegó / no llegó.
  z.object({ action: z.literal("verify_payment") }),
  z.object({ action: z.literal("reject_payment"), note: z.string().trim().min(3, "Escribe qué pasó.").max(500) }),
  // Quien lo registró: sube otro comprobante tras un rechazo.
  z.object({ action: z.literal("resubmit_payment"), evidenceUrl: z.string().url() }),
  // Daniel: anota la guía que generó.
  z.object({ action: z.literal("attach_guide"), guideNumber: z.string().trim().min(3, "Escribe la guía.").max(60) }),
  // Bryan: aprueba o no el arreglo en dinero.
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), note: z.string().trim().min(3, "Escribe el motivo.").max(500) }),
  // Admin: pagó al cliente.
  z.object({ action: z.literal("pay"), payoutProofUrl: z.string().url("Sube el comprobante.") }),
  // Quien lo registró (o el admin) antes de que avance.
  z.object({ action: z.literal("cancel") }),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = await getArrangementRole();
  if (!role) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { id } = await params;
  const a = await prisma.warrantyArrangement.findUnique({ where: { id } });
  if (!a) return NextResponse.json({ error: "No existe." }, { status: 404 });
  const code = arrangementCode(a.number);
  const now = new Date();
  const p = parsed.data;
  const deny = (msg: string) => NextResponse.json({ error: msg }, { status: 403 });
  const wrong = () => NextResponse.json({ error: "Este arreglo ya cambió de estado. Recarga la página." }, { status: 400 });

  switch (p.action) {
    case "verify_payment":
    case "reject_payment": {
      if (!role.isAdmin) return deny("Solo el administrador verifica el pago.");
      if (a.kind !== "RESHIP" || a.status !== "PAYMENT_REVIEW") return wrong();
      const ok = p.action === "verify_payment";
      const note = p.action === "reject_payment" ? p.note : null;
      await prisma.warrantyArrangement.update({ where: { id }, data: { status: ok ? "PAYMENT_OK" : "PAYMENT_REJECTED", reviewedById: role.userId, reviewedAt: now, reviewNote: note } });
      await arrangementNotices.paymentReviewed(code, a.orderNumber ?? "", ok, a.createdById, note);
      break;
    }
    case "resubmit_payment": {
      if (a.createdById !== role.userId) return deny("Solo quien lo registró sube otro comprobante.");
      if (a.status !== "PAYMENT_REJECTED") return wrong();
      await prisma.warrantyArrangement.update({ where: { id }, data: { status: "PAYMENT_REVIEW", evidenceUrl: p.evidenceUrl, reviewedById: null, reviewedAt: null } });
      await arrangementNotices.paymentSubmitted(code, a.orderNumber ?? "");
      break;
    }
    case "attach_guide": {
      if (!role.canAttachGuide) return deny("Solo Daniel anota la guía.");
      // Bloqueo pedido por el usuario: sin pago verificado no se despacha.
      if (a.status !== "PAYMENT_OK") return NextResponse.json({ error: "Todavía no se puede: el admin no ha verificado el pago del flete." }, { status: 400 });
      const guideNumber = p.guideNumber.toUpperCase().replace(/\s+/g, "");
      await prisma.warrantyArrangement.update({ where: { id }, data: { status: "DONE", guideNumber, guideAttachedAt: now, guideAttachedById: role.userId } });
      await arrangementNotices.guideAttached(code, guideNumber, a.createdById);
      break;
    }
    case "approve":
    case "reject": {
      if (!role.canApprove) return deny("Solo Bryan aprueba los arreglos en dinero.");
      if (a.kind !== "CASH" || a.status !== "APPROVAL") return wrong();
      const ok = p.action === "approve";
      const note = p.action === "reject" ? p.note : null;
      await prisma.warrantyArrangement.update({ where: { id }, data: { status: ok ? "TO_PAY" : "REJECTED", reviewedById: role.userId, reviewedAt: now, reviewNote: note } });
      await arrangementNotices.cashReviewed(code, ok, a.createdById, note);
      break;
    }
    case "pay": {
      if (!role.isAdmin) return deny("Solo el administrador paga desde la cuenta principal.");
      if (a.status !== "TO_PAY") return wrong();
      await prisma.warrantyArrangement.update({ where: { id }, data: { status: "PAID", payoutProofUrl: p.payoutProofUrl, paidAt: now } });
      await arrangementNotices.cashPaid(code, a.createdById);
      break;
    }
    case "cancel": {
      if (a.createdById !== role.userId && !role.isAdmin) return deny("Solo quien lo registró puede cancelarlo.");
      if (!["PAYMENT_REVIEW", "PAYMENT_REJECTED", "APPROVAL"].includes(a.status)) return NextResponse.json({ error: "Ya avanzó; no se puede cancelar." }, { status: 400 });
      await prisma.warrantyArrangement.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: now } });
      await arrangementNotices.cancelled(code);
      break;
    }
  }
  return NextResponse.json({ ok: true });
}
