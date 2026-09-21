import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { getFinanzasDeptId } from "@/lib/inventoryKpis";
import { getAllCurrentStock, declareManualCost } from "@/lib/stockKardex";

export type JustCostDeclarationCandidate = { catalogItemId: string; name: string; justCode: string | null; suggestedCost: number };

// Confirmado 2026-09-21, pedido explícito del usuario (admin): versión
// masiva de declareManualCost — en vez de entrar producto por producto al
// botón "Declarar costo" de Stock Actual, declara de una vez el precio de
// Just (SIN flete — acá no se conoce el flete de cada producto, sería
// adivinar) para todos los que están usando ese respaldo temporal
// (avgCost real en $0). Mismas reglas de seguridad que el botón individual:
// nunca pisa un producto que ya tenga costo real.
async function findCandidates(): Promise<JustCostDeclarationCandidate[]> {
  const deptId = await getFinanzasDeptId();
  if (!deptId) return [];
  const [rows, justSnapshots] = await Promise.all([
    getAllCurrentStock(),
    prisma.inventoryProductSnapshot.findMany({
      where: { deptId },
      distinct: ["productCode"],
      orderBy: [{ productCode: "asc" }, { createdAt: "desc" }],
      select: { productCode: true, avgCost: true },
    }),
  ]);
  const justAvgCostByCode = new Map(justSnapshots.map((s) => [s.productCode.trim(), s.avgCost]));

  const candidates: JustCostDeclarationCandidate[] = [];
  for (const r of rows) {
    if (r.avgCost > 0 || !r.justCode) continue;
    const suggestedCost = justAvgCostByCode.get(r.justCode.trim()) ?? 0;
    if (suggestedCost > 0) candidates.push({ catalogItemId: r.catalogItemId, name: r.name, justCode: r.justCode, suggestedCost });
  }
  return candidates.sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const candidates = await findCandidates();
  return NextResponse.json(candidates);
}

export async function POST() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const candidates = await findCandidates();
  const declaredById = session.user.role === "admin" ? null : session.user.id;

  let declaredCount = 0;
  for (const c of candidates) {
    try {
      await declareManualCost({ catalogItemId: c.catalogItemId, declaredCost: c.suggestedCost, declaredById });
      declaredCount++;
    } catch {
      // Ya tenía costo real (se adelantó otra declaración/compra) — se
      // salta sin romper el resto del lote.
    }
  }
  return NextResponse.json({ declaredCount, totalCandidates: candidates.length });
}
