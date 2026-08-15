import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getMonthDispatchSummary } from "@/lib/commissionTiers";
import { prevMonthStr } from "@/lib/pendingTasks";

function currentMonthStr(): string {
  const now = new Date(Date.now() - 5 * 3600 * 1000); // Ecuador UTC-5
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Confirmado 2026-08-14: público dentro de la empresa — todo el equipo lo
// ve en Inicio, no es información confidencial (a diferencia de los montos
// de comisión por persona, que sí lo son). Ajuste el mismo día: muestra el
// ÚLTIMO MES COMPLETO (nunca el mes en curso) — ver comentario largo en
// getCommissionProgress (src/lib/dashboard.ts) con el porqué.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const month = prevMonthStr(currentMonthStr());
  const [summary, tiers] = await Promise.all([
    getMonthDispatchSummary(month),
    prisma.commissionTier.findMany({ where: { isActive: true }, orderBy: { orderIndex: "asc" } }),
  ]);

  return NextResponse.json({
    month,
    dailyAvg: summary?.dailyAvg ?? null,
    from: summary?.from ?? null,
    to: summary?.to ?? null,
    tiers,
  });
}
