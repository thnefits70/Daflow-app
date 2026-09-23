import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canResolveSupplierStockout } from "@/lib/guards";

const resolveSchema = z
  .object({
    resolution: z.enum(["CLOSED_DROPI_ID", "STOCK_ZEROED", "OTHER"]),
    resolutionNote: z.string().trim().optional(),
  })
  // Confirmado con el usuario: lista fija para poder contar después, pero
  // "Otro" siempre necesita explicar qué se hizo.
  .refine((d) => d.resolution !== "OTHER" || !!d.resolutionNote, {
    message: "Escribe qué se hizo.",
    path: ["resolutionNote"],
  });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canResolveSupplierStockout())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const parsed = resolveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const d = parsed.data;

  const report = await prisma.supplierStockoutReport.findUnique({ where: { id }, select: { resolvedAt: true } });
  if (!report) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (report.resolvedAt) return NextResponse.json({ error: "Este reporte ya fue resuelto." }, { status: 409 });

  const updated = await prisma.supplierStockoutReport.update({
    where: { id },
    data: {
      resolution: d.resolution,
      resolutionNote: d.resolutionNote?.trim() || null,
      resolvedById: session.user.id,
      resolvedAt: new Date(),
    },
    include: {
      catalogItem: { select: { id: true, name: true, photos: true, justCode: true } },
      reportedBy: { select: { name: true } },
      resolvedBy: { select: { name: true } },
    },
  });
  return NextResponse.json(updated);
}
