import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnPurchaseInvoices, canSubmitPurchaseRequests } from "@/lib/guards";

const schema = z.object({ givesInvoice: z.boolean() });

// Confirmado 2026-09-24, pedido de Nairoby: marca fija "da factura Sí/No"
// por proveedor. La pueden poner Nairoby (desde Registrar factura) y
// Jariel/Bryan (al hacer la compra) — ellos también saben quién entrega
// factura. Admin también, como respaldo.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const allowed = session.user.role === "admin" || (await canActOnPurchaseInvoices()) || (await canSubmitPurchaseRequests());
  if (!allowed) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const supplier = await prisma.supplier.findUnique({ where: { id }, select: { id: true } });
  if (!supplier) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true } });
  const updated = await prisma.supplier.update({
    where: { id },
    data: { givesInvoice: parsed.data.givesInvoice, givesInvoiceSetAt: new Date(), givesInvoiceSetBy: me?.name ?? "Administración" },
    select: { id: true, givesInvoice: true, givesInvoiceSetAt: true, givesInvoiceSetBy: true },
  });
  return NextResponse.json(updated);
}
