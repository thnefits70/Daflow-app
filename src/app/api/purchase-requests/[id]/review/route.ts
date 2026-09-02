import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { sendPushToOwner } from "@/lib/webPush";
import { canApprovePurchaseRequests } from "@/lib/guards";

const schema = z.object({ action: z.enum(["approve", "reject"]), rejectReason: z.string().trim().optional() });

// Confirmado 2026-09-02: además de admin, quien tenga el nuevo permiso de
// aprobación con un clic (hoy Bryan) puede aprobar/rechazar — mismo cambio
// que en group/[groupId]/review/route.ts (que es la que de verdad usa la
// UI hoy; esta ruta de una sola fila se mantiene igual por consistencia).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canApprovePurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const existing = await prisma.purchaseRequest.findUnique({ where: { id }, include: { catalogItem: { select: { name: true } } } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.status !== "PENDING_APPROVAL") return NextResponse.json({ error: "Ya fue revisada." }, { status: 409 });

  // El admin (login "admin", sin fila real en User) guarda null, mismo
  // patrón que paidById en pay/route.ts.
  const actorId = session.user.role === "admin" ? null : session.user.id;
  const updated = await prisma.purchaseRequest.update({
    where: { id },
    data:
      parsed.data.action === "approve"
        ? { status: "APPROVED", reviewedById: actorId, reviewedAt: new Date() }
        : { status: "REJECTED", rejectReason: parsed.data.rejectReason, reviewedById: actorId, reviewedAt: new Date() },
  });

  if (existing.requestedById) {
    await sendPushToOwner(existing.requestedById, {
      title: parsed.data.action === "approve" ? "Solicitud aprobada" : "Solicitud rechazada",
      body: `${existing.catalogItem.name} — ${parsed.data.action === "approve" ? "sigue con el pago" : parsed.data.rejectReason || "sin motivo especificado"}`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
