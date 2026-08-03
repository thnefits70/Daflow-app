import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";

// Confirmado 2026-08-03: en vez de un catálogo de bancos aparte que alguien
// tenga que mantener, se sugieren los nombres de banco que ya se han escrito
// antes en cualquier proveedor — así nunca hay que volver a tipear el mismo
// banco dos veces, y la lista crece sola con el uso real.
export async function GET() {
  if (!(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const rows = await prisma.supplierBankAccount.findMany({
    distinct: ["bankName"],
    select: { bankName: true },
    orderBy: { bankName: "asc" },
  });
  return NextResponse.json(rows.map((r) => r.bankName));
}
