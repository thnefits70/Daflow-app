import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

// Confirmado 2026-09-15 (foto opcional de CHEN en su enlace público): igual
// que upload-sign/route.ts, sin auth() — valida el token del proveedor. Solo
// deja guardar la foto en un pedido que sea REALMENTE de este proveedor y
// que todavía esté APPROVED (esperando que él lo envíe) — así un token
// filtrado o adivinado no puede tocar pedidos de otro proveedor ni de otro
// estado. Puramente informativo: no notifica a nadie ni cambia el estado
// del pedido.
const bodySchema = z.object({
  url: z.string().trim().min(1),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string; requestId: string }> }) {
  const { token, requestId } = await params;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const supplier = await prisma.supplier.findUnique({ where: { publicLedgerTokenHash: tokenHash } });
  if (!supplier || supplier.paymentMode !== "CREDITO") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const purchaseRequest = await prisma.purchaseRequest.findUnique({ where: { id: requestId } });
  if (!purchaseRequest || purchaseRequest.supplierId !== supplier.id || purchaseRequest.status !== "APPROVED") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  await prisma.purchaseRequest.update({
    where: { id: requestId },
    data: { supplierShippingPhotoUrl: parsed.data.url, supplierShippingPhotoAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
