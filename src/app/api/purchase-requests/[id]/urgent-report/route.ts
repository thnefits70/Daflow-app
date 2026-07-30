import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canConfirmPurchaseReceiving } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

const schema = z.object({
  type: z.enum(["DAMAGED_INCOMPLETE", "NOT_ARRIVED"]),
  affectedQuantity: z.number().int().nonnegative().nullable().optional(),
  description: z.string().trim().min(1, "Describe brevemente qué pasó."),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canConfirmPurchaseReceiving()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const existing = await prisma.purchaseRequest.findUnique({ where: { id }, include: { catalogItem: { select: { name: true } } } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  const isAdmin = session.user.role === "admin";
  const report = await prisma.purchaseRequestUrgentReport.create({
    data: {
      requestId: id,
      type: parsed.data.type,
      affectedQuantity: parsed.data.affectedQuantity ?? null,
      description: parsed.data.description,
      reportedById: isAdmin ? null : session.user.id,
    },
  });

  const label = parsed.data.type === "NOT_ARRIVED" ? "🚨 Mercadería no ha llegado" : "🚨 Mercadería dañada o incompleta";
  const notifyTargets = new Set<string>(["admin"]);
  if (existing.requestedById) notifyTargets.add(existing.requestedById);

  await Promise.all(
    [...notifyTargets].map((ownerId) =>
      sendPushToOwner(ownerId, { title: label, body: `${existing.catalogItem.name} — ${parsed.data.description}`, url: "/admin" }).catch(() => null)
    )
  );

  return NextResponse.json(report, { status: 201 });
}
