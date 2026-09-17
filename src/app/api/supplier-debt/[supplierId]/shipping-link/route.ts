import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { canManageSupplierDebtPayments } from "@/lib/guards";

// Confirmado 2026-09-17 (pedido explícito del usuario): genera (o regenera,
// invalidando el anterior) el segundo enlace público — llave aparte de
// publicLedgerToken — que el proveedor de crédito (hoy solo CHEN) puede
// pasarle a su propio equipo de despacho. Ese enlace solo abre
// /proveedor-ledger/envios/[token] (lo que falta enviar), nunca el saldo.
export async function POST(req: NextRequest, { params }: { params: Promise<{ supplierId: string }> }) {
  if (!(await canManageSupplierDebtPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { supplierId } = await params;
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (supplier.paymentMode !== "CREDITO") return NextResponse.json({ error: "Este proveedor no es de crédito." }, { status: 409 });

  const token = crypto.randomBytes(32).toString("hex");

  await prisma.supplier.update({
    where: { id: supplierId },
    data: { publicShippingToken: token, publicShippingTokenCreatedAt: new Date() },
  });

  return NextResponse.json({ token });
}
