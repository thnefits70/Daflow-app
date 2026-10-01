import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canReportSupplierStockout } from "@/lib/guards";

// Pedido de Jariel 2026-10-01: cada 15 días "Qué comprar" le pregunta si el
// proveedor ya tiene el producto que marcó "Ningún proveedor lo tiene".
// not_yet = "Todavía no le llega" (vuelve a preguntar en 15 días);
// has_it = "Ya lo tiene" (vuelve a la lista normal de compras).
const schema = z.object({ answer: z.enum(["not_yet", "has_it"]) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canReportSupplierStockout())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const report = await prisma.supplierStockoutReport.findUnique({ where: { id }, select: { supplierBackAt: true } });
  if (!report) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (report.supplierBackAt) return NextResponse.json({ error: "Ya se marcó que el proveedor lo tiene." }, { status: 409 });

  const now = new Date();
  await prisma.supplierStockoutReport.update({
    where: { id },
    data: parsed.data.answer === "not_yet" ? { supplierCheckedAt: now } : { supplierBackAt: now },
  });
  return NextResponse.json({ ok: true });
}
