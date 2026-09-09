import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canPublishMarketProduct } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

const schema = z.object({
  quantity: z.number().int().positive().default(100),
  dropiProductId: z.string().trim().min(1, "Falta el ID de Dropi."),
});

// Confirmado 2026-09-09 (Fase 2, Análisis de Mercado): Heidy publica el
// producto ya aprobado en Dropi (nombre, cantidad por defecto 100,
// imágenes) y confirma con el ID real que Dropi le da. Recién en ESTE
// momento — no antes, el ID no existe hasta ahora — le llega a Daniel y a
// Robert.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canPublishMarketProduct()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const existing = await prisma.marketProductProposal.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.status !== "APPROVED") return NextResponse.json({ error: "Este producto todavía no está aprobado." }, { status: 409 });
  if (existing.publishedAt) return NextResponse.json({ error: "Ya está publicado." }, { status: 409 });

  const updated = await prisma.marketProductProposal.update({
    where: { id },
    data: { dropiProductId: parsed.data.dropiProductId, publishedById: session.user.id, publishedAt: new Date() },
  });

  const inventoryLead = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "INV" } }, select: { id: true } });
  if (inventoryLead) {
    await notifyOwner(inventoryLead.id, {
      title: "Producto publicado en Dropi",
      body: `${existing.productName} — ID ${parsed.data.dropiProductId}`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
