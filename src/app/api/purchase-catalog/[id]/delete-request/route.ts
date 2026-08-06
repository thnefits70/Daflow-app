import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

const schema = z.object({ reason: z.string().trim().optional() });

// Confirmado 2026-07-30: eliminar un insumo nunca es inmediato — se manda
// una solicitud pendiente para que el admin la apruebe, igual que ya
// funciona en otras partes de DAFLOW (PurchaseReceiptChangeRequest).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canSubmitPurchaseRequests()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "Producto, mercadería o insumo no encontrado." }, { status: 404 });

  const isAdmin = session.user.role === "admin";
  const existing = await prisma.purchaseCatalogItemDeleteRequest.upsert({
    where: { itemId: id },
    update: { reason: parsed.data.reason, requestedById: isAdmin ? null : session.user.id, requestedAt: new Date() },
    create: { itemId: id, reason: parsed.data.reason, requestedById: isAdmin ? null : session.user.id },
  });

  await sendPushToOwner("admin", {
    title: "🗑️ Solicitud de borrado de un producto",
    body: `"${item.name}"${parsed.data.reason ? ` — ${parsed.data.reason}` : ""}`,
    url: "/admin",
  }).catch(() => null);

  return NextResponse.json(existing, { status: 201 });
}
