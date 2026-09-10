import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { dbUserId } from "@/lib/guards";

// Confirmado 2026-09-10: expone SOLO el monto del propio usuario logueado
// por nivel — a diferencia de /api/commissions/amounts (roster completo),
// que exige canProposeCommissionAmounts. Alimenta el "¿cuánto ganaría?" del
// widget público CommissionProgressCard sin filtrar los montos de nadie más.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const userId = dbUserId(session.user.id);
  if (!userId) return NextResponse.json({ amounts: {} });

  const amounts = await prisma.commissionTierAmount.findMany({
    where: { userId },
    select: { tierId: true, amount: true },
  });

  return NextResponse.json({ amounts: Object.fromEntries(amounts.map((a) => [a.tierId, a.amount])) });
}
