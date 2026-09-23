import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canProposeMarketProduct, canReportSupplierStockout } from "@/lib/guards";
import { notifySupplierStockoutReported } from "@/lib/supplierStockout";

const supplierStockoutInclude = {
  catalogItem: { select: { id: true, name: true, photos: true, justCode: true } },
  reportedBy: { select: { name: true } },
  resolvedBy: { select: { name: true } },
} as const;

// Confirmado 2026-09-23, pedido de Jariel (vía el usuario): lo ve todo el
// equipo de Análisis de Mercado (mismo permiso que Proponer/Ganadores no
// encontrados) — resolver (cerrar el ID / bajar el stock) es exclusivo de
// Heidy y Bryan, ver canResolveSupplierStockout.
export async function GET() {
  if (!(await canProposeMarketProduct())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const rows = await prisma.supplierStockoutReport.findMany({
    include: supplierStockoutInclude,
    orderBy: { reportedAt: "desc" },
  });
  return NextResponse.json(rows);
}

const createSchema = z.object({
  catalogItemId: z.string().min(1),
  // Mensaje libre de Jariel a su equipo (qué hacer) — pedido explícito del
  // usuario, obligatorio, no es un campo fijo.
  instructionNote: z.string().trim().min(1, "Escribe qué debe hacer el equipo."),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canReportSupplierStockout())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const d = parsed.data;

  const catalogItem = await prisma.purchaseCatalogItem.findUnique({ where: { id: d.catalogItemId }, select: { id: true, name: true } });
  if (!catalogItem) return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });

  const created = await prisma.supplierStockoutReport.create({
    data: {
      catalogItemId: catalogItem.id,
      instructionNote: d.instructionNote,
      reportedById: session.user.id,
    },
    include: supplierStockoutInclude,
  });

  await notifySupplierStockoutReported({
    catalogItemName: catalogItem.name,
    instructionNote: d.instructionNote,
    reportedByName: created.reportedBy?.name ?? null,
  });

  return NextResponse.json(created, { status: 201 });
}
