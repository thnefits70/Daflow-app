import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { salaryAdvanceReceiptOverdue } from "@/lib/payroll";

// Anticipos propios que ya pasaron las 24 h sin confirmar — alimenta la
// ventana obligatoria (SalaryAdvanceReceiptGate).
export async function GET() {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json({ items: [] });

  const items = await prisma.salaryAdvance.findMany({
    where: { employeeId: session.user.id, status: "APPROVED", receiptConfirmedAt: null, receiptIssueReportedAt: null },
    select: { id: true, amount: true, approvedAt: true, transferProofUrl: true, status: true, receiptConfirmedAt: true, receiptIssueReportedAt: true },
    orderBy: { approvedAt: "asc" },
  });
  return NextResponse.json({
    items: items
      .filter((a) => salaryAdvanceReceiptOverdue(a))
      .map((a) => ({ id: a.id, amount: a.amount, approvedAt: a.approvedAt, transferProofUrl: a.transferProofUrl })),
  });
}
