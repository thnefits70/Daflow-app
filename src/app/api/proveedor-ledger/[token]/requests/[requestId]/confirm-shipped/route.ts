import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findSupplierByAnySupplierLedgerToken } from "@/lib/supplierDebt";

// Confirmado 2026-09-17 (pedido explícito del usuario): igual que
// upload-sign/photo/route.ts, sin auth() — el equipo de despacho del
// proveedor marca "ya lo enviamos" (con foto o sin ella) por cada pedido.
// Solo mueve la fila de "falta enviar" a un historial de solo lectura en el
// mismo enlace — NUNCA cambia el status real del pedido ni reemplaza la
// recepción que hace Daniel. Acepta el token del enlace completo o el de
// solo-envíos (findSupplierByAnySupplierLedgerToken), igual que la foto.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string; requestId: string }> }) {
  const { token, requestId } = await params;
  const supplier = await findSupplierByAnySupplierLedgerToken(token);
  if (!supplier || supplier.paymentMode !== "CREDITO") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const purchaseRequest = await prisma.purchaseRequest.findUnique({ where: { id: requestId } });
  if (!purchaseRequest || purchaseRequest.supplierId !== supplier.id || purchaseRequest.status !== "APPROVED") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  await prisma.purchaseRequest.update({
    where: { id: requestId },
    data: { supplierShippingConfirmedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
