import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canCloseExternalSale } from "@/lib/guards";

// Parte 4 — confirmado 2026-09-01: ventas ya cerradas, acumuladas en un
// solo lugar (B2B y B2C juntas) para poder auditar el proceso completo más
// adelante. Solo lectura — nadie actúa desde acá.
export async function GET() {
  if (!(await canCloseExternalSale())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const sales = await prisma.externalSale.findMany({
    where: { nairobyClosedAt: { not: null }, deletedAt: null },
    select: {
      id: true,
      code: true,
      declaredProductName: true,
      catalogItem: { select: { name: true } },
      quantity: true,
      totalAmount: true,
      isContraEntrega: true,
      createdAt: true,
      nairobyClosedAt: true,
      advisor: { select: { name: true } },
    },
    orderBy: { nairobyClosedAt: "desc" },
  });

  const totalCount = sales.length;
  const totalAmount = sales.reduce((sum, s) => sum + s.totalAmount, 0);

  const b2b = sales.filter((s) => !s.isContraEntrega);
  const b2c = sales.filter((s) => s.isContraEntrega);

  const byAdvisor = new Map<string, { name: string; count: number; amount: number }>();
  for (const s of sales) {
    const name = s.advisor?.name ?? "—";
    const entry = byAdvisor.get(name) ?? { name, count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += s.totalAmount;
    byAdvisor.set(name, entry);
  }

  return NextResponse.json({
    totals: {
      count: totalCount,
      amount: totalAmount,
      b2b: { count: b2b.length, amount: b2b.reduce((sum, s) => sum + s.totalAmount, 0) },
      b2c: { count: b2c.length, amount: b2c.reduce((sum, s) => sum + s.totalAmount, 0) },
    },
    byAdvisor: [...byAdvisor.values()].sort((a, b) => b.amount - a.amount),
    sales,
  });
}
