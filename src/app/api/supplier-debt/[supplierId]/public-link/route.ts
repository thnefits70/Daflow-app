import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { canManageSupplierDebtPayments } from "@/lib/guards";

// Confirmado 2026-09-08 (Fase 1, proveedores con crédito): genera (o
// regenera, invalidando el anterior) el enlace público de solo lectura para
// que el proveedor de crédito (hoy solo CHEN) vea su propio saldo.
// Confirmado 2026-09-15, pedido explícito del usuario: ahora el token se
// guarda tal cual (no solo el hash) para poder mostrarlo siempre en el panel
// de admin sin tener que regenerarlo — ver el comentario en schema.prisma.
export async function POST(req: NextRequest, { params }: { params: Promise<{ supplierId: string }> }) {
  if (!(await canManageSupplierDebtPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { supplierId } = await params;
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (supplier.paymentMode !== "CREDITO") return NextResponse.json({ error: "Este proveedor no es de crédito." }, { status: 409 });

  const token = crypto.randomBytes(32).toString("hex");

  await prisma.supplier.update({
    where: { id: supplierId },
    // publicLedgerTokenHash se limpia — un enlace nuevo ya no depende de él,
    // solo los enlaces generados antes de este cambio siguen usándolo.
    data: { publicLedgerToken: token, publicLedgerTokenHash: null, publicLedgerTokenCreatedAt: new Date() },
  });

  return NextResponse.json({ token });
}
