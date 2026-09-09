import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnMarketProductReview } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

const schema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("APPROVED"),
    bodega: z.enum(["MKT_DAMIAN", "MKT_PROVEDIX", "MKT_SHANGHAI"]),
    isPublic: z.boolean(),
  }),
  z.object({
    decision: z.literal("REJECTED"),
    rejectReason: z.string().trim().min(1, "Falta el motivo del rechazo."),
  }),
]);

// Confirmado 2026-09-09 (Fase 2, Análisis de Mercado): exclusivo del líder
// de MKT (hoy Bryan) — aprobar decide bodega y público/privado de una vez;
// rechazar exige motivo. En simultáneo al aprobar, Daniel recibe la misma
// info como referencia (nombre, precio de venta, imagen) — sin el ID de
// Dropi, que todavía no existe en este momento.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnMarketProductReview()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const existing = await prisma.marketProductProposal.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.status !== "PENDING_APPROVAL") return NextResponse.json({ error: "Ya fue revisada." }, { status: 409 });

  const isAdmin = session.user.role === "admin";
  const reviewedById = isAdmin ? null : session.user.id;

  const updated = await prisma.marketProductProposal.update({
    where: { id },
    data:
      parsed.data.decision === "APPROVED"
        ? { status: "APPROVED", reviewedById, reviewedAt: new Date(), bodega: parsed.data.bodega, isPublic: parsed.data.isPublic }
        : { status: "REJECTED", reviewedById, reviewedAt: new Date(), rejectReason: parsed.data.rejectReason },
  });

  if (existing.proposedById) {
    await notifyOwner(existing.proposedById, {
      title: parsed.data.decision === "APPROVED" ? "Producto aprobado" : "Producto rechazado",
      body: `${existing.productName}${parsed.data.decision === "REJECTED" ? ` — ${parsed.data.rejectReason}` : ""}`,
      url: "/area/workspace?tab=analisis-mercado",
    }).catch(() => null);
  }

  if (parsed.data.decision === "APPROVED") {
    // Confirmado 2026-09-09: pedido explícito del usuario — en el mismo
    // instante que Bryan aprueba, Daniel recibe la misma info como
    // referencia (todavía sin ID de Dropi, no existe hasta que Heidy
    // publica) para tenerlo en su radar antes de que llegue físico.
    const inventoryLead = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "INV" } }, select: { id: true } });
    if (inventoryLead) {
      await notifyOwner(inventoryLead.id, {
        title: "Nuevo producto aprobado — referencia",
        body: `${existing.productName} — precio de venta $${existing.calculatedSalePrice.toFixed(2)}`,
        url: "/area/workspace",
      }).catch(() => null);
    }
  }

  return NextResponse.json(updated);
}
