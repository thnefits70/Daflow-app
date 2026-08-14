import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canProposeCommissionAmounts } from "@/lib/guards";

// Confirmado 2026-08-14: pedido explícito del usuario — Nairoby (o admin)
// ve una lista compacta de qué bonos otorgó el CEO, para saber que vienen
// incluidos en la próxima quincena. Nunca visible a nadie más.
export async function GET() {
  if (!(await canProposeCommissionAmounts())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const grants = await prisma.ceoBonusGrant.findMany({
    orderBy: { grantedAt: "desc" },
    take: 50,
    include: { user: { select: { name: true } } },
  });
  return NextResponse.json(grants);
}
