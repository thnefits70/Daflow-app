import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { sendPushToOwner } from "@/lib/webPush";

const schema = z.object({ action: z.enum(["approve", "reject"]), rejectReason: z.string().trim().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const existing = await prisma.purchaseRequest.findUnique({ where: { id }, include: { catalogItem: { select: { name: true } } } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.status !== "PENDING_APPROVAL") return NextResponse.json({ error: "Ya fue revisada." }, { status: 409 });

  const updated = await prisma.purchaseRequest.update({
    where: { id },
    data:
      parsed.data.action === "approve"
        ? { status: "APPROVED", reviewedById: null, reviewedAt: new Date() }
        : { status: "REJECTED", rejectReason: parsed.data.rejectReason, reviewedById: null, reviewedAt: new Date() },
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
