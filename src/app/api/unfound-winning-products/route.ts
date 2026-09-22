import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canProposeMarketProduct } from "@/lib/guards";
import { currentIsoWeek } from "@/lib/weeklyCheckin";
import { unfoundWinningProductSchema, unfoundWinningProductInclude } from "@/lib/unfoundWinningProduct";

// Confirmado 2026-09-22, pedido de Jariel: "productos ganadores no
// encontrados" — la hoja que llevaba aparte (imagen, nombre, ID y precio de
// la competencia, proveedor opcional, semana) ahora vive en DAFLOW. Lo ve
// todo el equipo de Análisis de Mercado (mismo permiso que Proponer), para
// que la lista no dependa de una sola persona.
export async function GET() {
  if (!(await canProposeMarketProduct())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const rows = await prisma.unfoundWinningProduct.findMany({
    include: unfoundWinningProductInclude,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canProposeMarketProduct())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const parsed = unfoundWinningProductSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const d = parsed.data;

  // "2026-W39" → año 2026, semana 39 (hora Ecuador, se autorellena).
  const [weekYear, weekNumber] = currentIsoWeek().split("-W").map(Number);

  const created = await prisma.unfoundWinningProduct.create({
    data: {
      productName: d.productName,
      imageUrl: d.imageUrl,
      competitorId: d.competitorId || null,
      competitorPrice: d.competitorPrice ?? null,
      supplierId: d.supplierId || null,
      notes: d.notes || null,
      weekYear,
      weekNumber,
      createdById: session.user.role === "admin" ? null : session.user.id,
    },
    include: unfoundWinningProductInclude,
  });
  return NextResponse.json(created, { status: 201 });
}
