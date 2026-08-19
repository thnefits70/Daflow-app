import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Mismo criterio que /api/purchase-suppliers/bank-names — se sugieren
// nombres de banco ya escritos antes (acá, en cualquiera de las 4 tablas de
// cuentas bancarias) en vez de mantener un catálogo aparte.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const [supplierRows, payeeRows, employeeRows, pettyCashRows] = await Promise.all([
    prisma.supplierBankAccount.findMany({ distinct: ["bankName"], select: { bankName: true } }),
    prisma.adminPaymentPayeeBankAccount.findMany({ distinct: ["bankName"], select: { bankName: true } }),
    prisma.employeeBankAccount.findMany({ distinct: ["bankName"], select: { bankName: true } }),
    prisma.pettyCashPayoutAccount.findMany({ distinct: ["bankName"], select: { bankName: true } }),
  ]);
  const names = Array.from(new Set([...supplierRows, ...payeeRows, ...employeeRows, ...pettyCashRows].map((r) => r.bankName))).sort();
  return NextResponse.json(names);
}
