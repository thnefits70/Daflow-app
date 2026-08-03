import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";

const patchSchema = z.object({
  email: z.string().trim().email().optional().or(z.literal("")),
});

// Confirmado 2026-08-03: algunos proveedores piden que el comprobante de
// pago se les envíe por correo — se puede agregar o actualizar en cualquier
// momento, no solo al registrar el proveedor por primera vez.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Correo inválido." }, { status: 400 });

  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const updated = await prisma.supplier.update({
    where: { id },
    data: { email: parsed.data.email || null },
  });
  return NextResponse.json(updated);
}
