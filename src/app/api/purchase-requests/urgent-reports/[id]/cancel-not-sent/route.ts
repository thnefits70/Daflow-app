import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { cancelNotSentBlocker } from "@/lib/purchaseCancelNotSent";
import { cancelPurchaseNotSent } from "@/lib/purchaseWontArrive";

const schema = z.object({ note: z.string().trim().min(3, "Escribe el motivo (ej. CHEN no tiene stock).") });

// Pedido del usuario 2026-10-10: cancelar una compra que el proveedor nunca
// envió (ver purchaseCancelNotSent.ts). Lo hace quien compró — es quien
// habla con el proveedor — o el admin. La lógica vive en
// cancelPurchaseNotSent (purchaseWontArrive.ts), que también usa "No
// llegará — solo se pagará lo que llegó" con proveedores a crédito.
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
      reviewedByLeadAt: true,
      rejectedAt: true,
      request: {
        include: {
          receipt: { select: { id: true } },
          urgentReports: { include: { resolutions: { select: { status: true } } } },
        },
      },
    },
  });
  if (!report) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const r = report.request;
  if (!isAdmin && session.user.id !== r.requestedById) {
    return NextResponse.json({ error: "Solo quien hizo la compra (o el admin) puede cancelarla." }, { status: 403 });
  }
  if (!report.reviewedByLeadAt || report.rejectedAt) return NextResponse.json({ error: "Este reclamo todavía no llegó a Compras." }, { status: 409 });
  const blocker = cancelNotSentBlocker(r);
  if (blocker) return NextResponse.json({ error: blocker }, { status: 409 });

  await cancelPurchaseNotSent({ requestId: r.id, actorId: isAdmin ? null : session.user.id, note: parsed.data.note });
  return NextResponse.json({ ok: true });
}
