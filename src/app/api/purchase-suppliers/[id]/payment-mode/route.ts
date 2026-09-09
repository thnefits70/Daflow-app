import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageSupplierPaymentMode } from "@/lib/guards";

const schema = z.object({ paymentMode: z.enum(["PREPAGO", "CREDITO"]) });

// Confirmado 2026-09-08 (Fase 1, proveedores con crédito): cambiar el modo
// de pago de un proveedor es exclusivo del admin, ruta aparte de la general
// (PATCH /api/purchase-suppliers/[id]) por el mismo motivo que las cuentas
// bancarias tienen su propia ruta — dato financiero sensible.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageSupplierPaymentMode())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const updated = await prisma.supplier.update({
    where: { id },
    data: { paymentMode: parsed.data.paymentMode },
  });
  return NextResponse.json(updated);
}
