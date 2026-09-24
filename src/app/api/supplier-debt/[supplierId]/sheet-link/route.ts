import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { canManageSupplierDebtPayments } from "@/lib/guards";

// Confirmado 2026-09-24, pedido explícito del usuario: genera (o regenera,
// invalidando el anterior) el tercer enlace público — la hoja de cálculo en
// línea para todo el equipo de CHEN (/proveedor-ledger/hoja/[token]).
// Regenerar solo cambia la llave: lo que ya escribieron en la hoja se queda.
export async function POST(req: NextRequest, { params }: { params: Promise<{ supplierId: string }> }) {
  if (!(await canManageSupplierDebtPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { supplierId } = await params;
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (supplier.paymentMode !== "CREDITO") return NextResponse.json({ error: "Este proveedor no es de crédito." }, { status: 409 });

  const token = crypto.randomBytes(32).toString("hex");
  await prisma.supplier.update({
    where: { id: supplierId },
    data: { publicSheetToken: token, publicSheetTokenCreatedAt: new Date() },
  });

  return NextResponse.json({ token });
}
