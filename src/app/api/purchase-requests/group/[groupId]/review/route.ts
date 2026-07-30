import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { sendPushToOwner } from "@/lib/webPush";

const schema = z.object({ action: z.enum(["approve", "reject"]), rejectReason: z.string().trim().optional() });

// Confirmado 2026-07-31: una cotización con varios productos se aprueba o
// rechaza COMO UNA SOLA compra — aplica a todas las filas del groupId a la
// vez, no producto por producto.
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const rows = await prisma.purchaseRequest.findMany({ where: { groupId }, include: { catalogItem: { select: { name: true } } } });
  if (rows.length === 0) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (rows.some((r) => r.status !== "PENDING_APPROVAL")) return NextResponse.json({ error: "Ya fue revisada." }, { status: 409 });

  await prisma.purchaseRequest.updateMany({
    where: { groupId },
    data:
      parsed.data.action === "approve"
        ? { status: "APPROVED", reviewedById: null, reviewedAt: new Date() }
        : { status: "REJECTED", rejectReason: parsed.data.rejectReason, reviewedById: null, reviewedAt: new Date() },
  });

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
