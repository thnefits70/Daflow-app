import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManageInventoryControl } from "@/lib/guards";
import { currentQuarter } from "@/lib/inventoryKpisCalc";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  action: z.enum(["stay", "recover"]).optional(),
  value: z.number().nonnegative().optional(),
});

// Confirmado 2026-08-04: los productos de esta lista NUNCA se eliminan — acá
// solo se reconfirma "sigue igual" (stay, suma un trimestre), se marca "ya
// se vende" (recover), o se corrige el valor (value). Cada acción llega
// separada, nunca combinada en un mismo PATCH.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canManageInventoryControl()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success || (!parsed.data.action && parsed.data.value === undefined)) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const product = await prisma.inventoryStaleProduct.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });

  const updatedById = session.user.role === "admin" ? null : session.user.id;
  const thisQuarter = currentQuarter();

  if (parsed.data.action === "stay") {
    if (product.lastConfirmedQuarter === thisQuarter) {
      return NextResponse.json({ ok: true, product }); // ya confirmado este trimestre, idempotente
    }
    const updated = await prisma.inventoryStaleProduct.update({
      where: { id },
      data: { quartersConfirmed: product.quartersConfirmed + 1, lastConfirmedQuarter: thisQuarter, updatedById },
    });
    return NextResponse.json({ ok: true, product: updated });
  }

  if (parsed.data.action === "recover") {
    const updated = await prisma.inventoryStaleProduct.update({
      where: { id },
      data: { status: "recovered", recoveredQuarter: thisQuarter, updatedById },
    });
    return NextResponse.json({ ok: true, product: updated });
  }

  if (parsed.data.value !== undefined) {
    const updated = await prisma.inventoryStaleProduct.update({
      where: { id },
      data: { value: parsed.data.value, updatedById },
    });
    return NextResponse.json({ ok: true, product: updated });
  }

  return NextResponse.json({ error: "Nada que actualizar." }, { status: 400 });
}
