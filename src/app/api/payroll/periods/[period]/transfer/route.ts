import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewPayrollRoles, getFinanceLeadId } from "@/lib/guards";
import { isValidPeriod } from "@/lib/payroll";

const BANK_ACCOUNT_SELECT = {
  bankName: true,
  bankAccountType: true,
  bankAccountNumber: true,
  bankAccountHolder: true,
  holderIdType: true,
  holderIdNumber: true,
} as const;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await canViewPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({ where: { period }, include: { transfer: true } });
  if (!payrollPeriod?.transfer) return NextResponse.json(null);

  const transfer = payrollPeriod.transfer;
  const account =
    transfer.destination === "NAIROBY"
      ? await (async () => {
          const financeLeadId = await getFinanceLeadId();
          if (!financeLeadId) return null;
          const row = await prisma.employeeBankAccount.findFirst({
            where: { employeeId: financeLeadId, isSelected: true },
            select: BANK_ACCOUNT_SELECT,
          });
          return row;
        })()
      : transfer.destination === "ADMIN_COMPANY"
      ? await prisma.companyBankAccount.findUnique({ where: { id: "singleton" }, select: BANK_ACCOUNT_SELECT })
      : await prisma.adminPayrollBankAccount.findUnique({ where: { id: "singleton" }, select: BANK_ACCOUNT_SELECT });

  return NextResponse.json({ ...transfer, account });
}
