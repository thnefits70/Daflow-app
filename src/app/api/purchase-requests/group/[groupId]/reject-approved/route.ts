import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { notifyOwner } from "@/lib/notifications";
import { releaseCreditsForGroup } from "@/lib/supplierCredits";
import { formatPurchaseRequestCode } from "@/lib/purchases";

const schema = z.object({ rejectReason: z.string().trim().min(1, "Escribe el motivo del rechazo.") });

// Confirmado 2026-10-08 (SC-170, Zheng Wu): una solicitud llegó aprobada con
// $7,119 cuando la cotización decía $867, y una vez aprobada nadie podía
// rechazarla (review/ solo acepta PENDING_APPROVAL). Solo el admin, solo
// antes de pagar: queda REJECTED como cualquier rechazo normal, así quien la
// pidió la corrige en su lugar (mismo SC-XXX, ver resubmit/), y el crédito
// reservado vuelve a quedar libre.
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const rows = await prisma.purchaseRequest.findMany({
    where: { groupId },
    select: { id: true, status: true, shippingPaidAt: true, requestedById: true, reviewedById: true, requestNumber: true, catalogItem: { select: { name: true } } },
  });
  if (rows.length === 0) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (rows.some((r) => r.status !== "APPROVED")) {
    return NextResponse.json({ error: "Solo se puede rechazar aquí una solicitud aprobada que todavía no se pagó." }, { status: 409 });
  }
  if (rows.some((r) => r.shippingPaidAt)) {
    return NextResponse.json({ error: "El flete de esta solicitud ya se pagó — no se puede rechazar desde aquí." }, { status: 409 });
  }

  const reason = parsed.data.rejectReason;
  const updated = await prisma.purchaseRequest.updateMany({
    where: { groupId, status: "APPROVED" },
    data: { status: "REJECTED", rejectReason: reason, reviewedById: null, reviewedAt: new Date() },
  });
  if (updated.count !== rows.length) return NextResponse.json({ error: "La solicitud cambió mientras tanto — recarga." }, { status: 409 });

  await releaseCreditsForGroup(groupId);

  const code = rows[0].requestNumber ? formatPurchaseRequestCode(rows[0].requestNumber) : "Solicitud";
  const names = rows.map((r) => r.catalogItem.name).join(", ");
  const notice = { title: `${code} rechazada antes de pagar`, body: `${names} — ${reason}`, url: "/area/workspace" };
  const notified = new Set<string>();
  for (const userId of [rows[0].requestedById, rows[0].reviewedById]) {
    if (!userId || notified.has(userId)) continue;
    notified.add(userId);
    await notifyOwner(userId, notice).catch(() => null);
  }

  return NextResponse.json({ ok: true });
}
