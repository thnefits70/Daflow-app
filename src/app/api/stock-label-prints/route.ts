import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canManageJustCatalog } from "@/lib/guards";
import { actorName } from "@/lib/actorName";

// Pedido de Daniel 2026-10-02 (Etiquetas de percha): cuántas veces se imprimió
// el QR de cada producto + cuáles aún no tienen etiqueta. Mismo acceso que la
// pantalla (canManageJustCatalog: admin o líder de Inventario).
export type StockLabelPrintSummary = Record<string, { count: number; manual: boolean; lastAt: string; lastBy: string }>;

export async function GET() {
  const session = await auth();
  if (!session || !(await canManageJustCatalog())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const rows = await prisma.stockLabelPrint.findMany({
    orderBy: { printedAt: "asc" },
    select: { catalogItemId: true, manual: true, printedAt: true, printedBy: { select: { name: true } } },
  });
  const out: StockLabelPrintSummary = {};
  for (const r of rows) {
    const s = (out[r.catalogItemId] ??= { count: 0, manual: false, lastAt: "", lastBy: "" });
    if (r.manual) s.manual = true;
    else s.count++;
    s.lastAt = r.printedAt.toISOString();
    s.lastBy = actorName(r.printedBy?.name);
  }
  return NextResponse.json(out);
}

const schema = z.object({ catalogItemIds: z.array(z.string().min(1)).min(1).max(500), manual: z.boolean().optional() });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canManageJustCatalog())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos." }, { status: 400 });

  const ids = [...new Set(parsed.data.catalogItemIds)];
  const existing = await prisma.purchaseCatalogItem.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const manual = parsed.data.manual ?? false;
  await prisma.stockLabelPrint.createMany({
    data: existing.map((i) => ({ catalogItemId: i.id, manual, printedById: session.user.role === "admin" ? null : session.user.id })),
  });
  return NextResponse.json({ ok: true, saved: existing.length });
}
