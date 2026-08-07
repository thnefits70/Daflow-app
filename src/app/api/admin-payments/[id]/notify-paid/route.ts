import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendPushToOwner } from "@/lib/webPush";

// Confirmado 2026-08-06: además del aviso automático que ya se dispara al
// subir un comprobante que calza (upload-proof/route.ts), el admin tiene acá
// una acción explícita y reenviable — mismo espíritu que "Recordar pago" —
// para el caso en que quien solicitó no haya visto la primera notificación.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const request = await prisma.adminPaymentRequest.findUnique({ where: { id } });
  if (!request) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (!request.paymentProofUrl) return NextResponse.json({ error: "Todavía no hay comprobante de pago." }, { status: 409 });

  if (request.createdById) {
    await sendPushToOwner(request.createdById, {
      title: "✅ Confirmación de pago",
      body: `${request.motivo} — $${request.monto.toFixed(2)} ya se pagó. Revisa el comprobante para reenviarlo si corresponde.`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true });
}
