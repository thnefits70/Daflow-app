import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { sendPushToOwner } from "@/lib/webPush";
import { releaseCreditsForGroup } from "@/lib/supplierCredits";
import { canApprovePurchaseRequests } from "@/lib/guards";

const schema = z.object({ action: z.enum(["approve", "reject"]), rejectReason: z.string().trim().optional() });

// Confirmado 2026-07-31: una cotización con varios productos se aprueba o
// rechaza COMO UNA SOLA compra — aplica a todas las filas del groupId a la
// vez, no producto por producto.
// Confirmado 2026-09-02: pedido explícito del usuario — además de admin,
// quien tenga el nuevo permiso de aprobación con un clic (hoy Bryan) puede
// aprobar/rechazar (ver canApprovePurchaseRequests en guards.ts). Admin
// sigue pudiendo también, como respaldo.
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await auth();
  if (!session || !(await canApprovePurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const rows = await prisma.purchaseRequest.findMany({ where: { groupId }, include: { catalogItem: { select: { name: true } } } });
  if (rows.length === 0) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (rows.some((r) => r.status !== "PENDING_APPROVAL")) return NextResponse.json({ error: "Ya fue revisada." }, { status: 409 });

  // Confirmado 2026-09-02: pedido explícito del usuario — antes reviewedById
  // se dejaba siempre en null; ahora sí registra a quien aprobó de verdad
  // (Bryan) para que "Aprobada por X" en Mis solicitudes/Auditoría muestre a
  // la persona correcta. El admin (login "admin", sin fila real en User)
  // sigue guardando null, mismo patrón que paidById en pay/route.ts.
  const isAdmin = session.user.role === "admin";
  const actorId = isAdmin ? null : session.user.id;
  await prisma.purchaseRequest.updateMany({
    where: { groupId },
    data:
      parsed.data.action === "approve"
        ? { status: "APPROVED", reviewedById: actorId, reviewedAt: new Date() }
        : { status: "REJECTED", rejectReason: parsed.data.rejectReason, reviewedById: actorId, reviewedAt: new Date() },
  });

  // Confirmado 2026-08-12: pedido explícito del usuario — si se rechaza por
  // completo, cualquier crédito reservado para esta solicitud vuelve a
  // quedar libre de inmediato.
  if (parsed.data.action === "reject") {
    await releaseCreditsForGroup(groupId);
  }

  const requestedById = rows[0].requestedById;
  if (requestedById) {
    const names = rows.map((r) => r.catalogItem.name).join(", ");
    await sendPushToOwner(requestedById, {
      title: parsed.data.action === "approve" ? "Solicitud aprobada" : "Solicitud rechazada",
      body: `${names} — ${parsed.data.action === "approve" ? "sigue con el pago" : parsed.data.rejectReason || "sin motivo especificado"}`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  const updated = await prisma.purchaseRequest.findMany({ where: { groupId } });
  return NextResponse.json(updated);
}
