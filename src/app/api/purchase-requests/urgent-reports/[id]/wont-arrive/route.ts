import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canMarkWontArrive, cancelPurchaseNotSent, closeMissingPayOnlyArrived, wontArriveMode } from "@/lib/purchaseWontArrive";

const schema = z.object({ note: z.string().trim().min(3, "Escribe el motivo (ej. CHEN no tiene stock).") });

// Pedido de Jariel 2026-10-15: "No llegará — solo se pagará lo que llegó",
// solo con proveedores a crédito (ver purchaseWontArrive.ts). Si no llegó
// nada se cancela la compra; si llegó una parte, lo que falta no se paga.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const isAdmin = session.user.role === "admin";

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const { id } = await params;
  const report = await prisma.purchaseRequestUrgentReport.findUnique({
    where: { id },
    select: {
      isLateClaim: true,
      reviewedByLeadAt: true,
      rejectedAt: true,
      resolvedInternallyAt: true,
      missingQty: true,
      damagedQty: true,
      incompleteQty: true,
      differentQty: true,
      resolutions: { select: { status: true, quantity: true } },
      request: {
        include: {
          supplier: { select: { paymentMode: true } },
          receipt: { select: { id: true } },
          urgentReports: { include: { resolutions: { select: { status: true } } } },
        },
      },
    },
  });
  if (!report) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!(await canMarkWontArrive({ userId: session.user.id, isAdmin, requestedById: report.request.requestedById }))) {
    return NextResponse.json({ error: "Solo quien hizo la compra, Compras o el admin pueden hacerlo." }, { status: 403 });
  }

  const m = wontArriveMode(report);
  if (m.mode === null) return NextResponse.json({ error: m.blocker }, { status: 409 });

  const actorId = isAdmin ? null : session.user.id;
  if (m.mode === "cancel") {
    await cancelPurchaseNotSent({ requestId: report.request.id, actorId, note: parsed.data.note });
  } else {
    await closeMissingPayOnlyArrived({ reportId: id, qty: m.qty, actorId, note: parsed.data.note });
  }
  return NextResponse.json({ ok: true, mode: m.mode });
}
