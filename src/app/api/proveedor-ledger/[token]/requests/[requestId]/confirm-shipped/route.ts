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
  // Corregido 2026-09-17: antes exigía status "APPROVED" — así que si
  // Daniel ya había recibido la mercadería (proceso interno nuestro) ANTES
  // de que el equipo de CHEN entrara a confirmar, este endpoint rechazaba
  // el clic con un 403. Esta confirmación es de ellos, no debe depender de
  // en qué status esté el pedido para nosotros — solo que sea de este
  // proveedor y que Bryan ya lo haya aprobado.
  if (
    !purchaseRequest ||
    purchaseRequest.supplierId !== supplier.id ||
    purchaseRequest.status === "PENDING_APPROVAL" ||
    purchaseRequest.status === "REJECTED"
  ) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  await prisma.purchaseRequest.update({
    where: { id: requestId },
    data: { supplierShippingConfirmedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
