import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canDecideMarketProductPurchase } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

const schema = z.object({ chosenSupplierId: z.string() });

// Confirmado 2026-09-09 (Fase 2, Análisis de Mercado, paso 6): exclusivo
// del líder de MKT (hoy Bryan) — con toda la trazabilidad ya a la vista,
// decide qué proveedor usar (prepago o crédito, ver Supplier.paymentMode /
// Fase 1) y marca el producto listo para que Jariel lo compre de verdad en
// Control de Compras. No crea ninguna PurchaseRequest acá — solo marca.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canDecideMarketProductPurchase()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Falta elegir el proveedor." }, { status: 400 });

  const existing = await prisma.marketProductProposal.findUnique({
    where: { id },
    include: { supplierPrices: true },
  });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.status !== "APPROVED" || !existing.brandedAt) {
    return NextResponse.json({ error: "El producto todavía no terminó Publicar/Brandear." }, { status: 409 });
  }
  if (!existing.supplierPrices.some((sp) => sp.supplierId === parsed.data.chosenSupplierId)) {
    return NextResponse.json({ error: "Ese proveedor no está entre los cargados en la propuesta." }, { status: 400 });
  }

  const isAdmin = session.user.role === "admin";
  const updated = await prisma.marketProductProposal.update({
    where: { id },
    data: { chosenSupplierId: parsed.data.chosenSupplierId, readyToBuyAt: new Date(), readyToBuyById: isAdmin ? null : session.user.id },
  });

  if (existing.proposedById) {
    await notifyOwner(existing.proposedById, {
      title: "Producto listo para comprar",
      body: existing.productName,
      url: "/area/workspace?tab=analisis-mercado",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
