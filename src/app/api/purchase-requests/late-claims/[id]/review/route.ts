import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnPurchaseReceiving } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(1, "Explica por qué no procede.") }),
]);

// Confirmado 2026-08-25: a diferencia de "Informar urgente" (que no tiene
// rechazo — reviewedByLeadAt siempre implicó aprobado), un reclamo posterior
// al cierre SÍ puede rechazarse, con motivo obligatorio — pedido explícito
// del usuario para que quede trazado por qué no se recuperó ese dinero,
// nunca desaparece. Al aprobar, se fija justWriteOffQty = damagedQty, que
// la confirmación reforzada de Just deberá igualar exactamente.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseReceiving()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const existing = await prisma.purchaseRequestUrgentReport.findUnique({
    where: { id },
    include: { request: { select: { requestedById: true, catalogItem: { select: { name: true } } } } },
  });
  if (!existing || !existing.isLateClaim) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (existing.reviewedByLeadAt || existing.rejectedAt) return NextResponse.json({ error: "Ya fue revisado." }, { status: 409 });

  const isAdmin = session.user.role === "admin";
  const notifyTargets = new Set<string>(["admin"]);
  if (existing.reportedById) notifyTargets.add(existing.reportedById);

  if (parsed.data.action === "reject") {
    const reason = parsed.data.reason;
    await prisma.purchaseRequestUrgentReport.update({
      where: { id },
      data: { rejectedAt: new Date(), rejectedById: isAdmin ? null : session.user.id, rejectionReason: reason },
    });
    await Promise.all(
      [...notifyTargets].map((ownerId) =>
        sendPushToOwner(ownerId, {
          title: "Reclamo posterior al cierre rechazado",
          body: `${existing.request.catalogItem.name} — ${existing.lateClaimCode}: ${reason}`,
          url: ownerId === "admin" ? "/admin" : "/area/workspace?tab=compras&ptab=inventario",
        }).catch(() => null)
      )
    );
    return NextResponse.json({ ok: true });
  }

  const updated = await prisma.purchaseRequestUrgentReport.update({
    where: { id },
    data: {
      reviewedByLeadId: isAdmin ? null : session.user.id,
      reviewedByLeadAt: new Date(),
      justWriteOffQty: existing.damagedQty,
    },
  });

  await Promise.all(
    [...notifyTargets].map((ownerId) =>
      sendPushToOwner(ownerId, {
        title: "✓ Reclamo posterior al cierre aprobado",
        body: `${existing.request.catalogItem.name} — ${existing.lateClaimCode}: falta darlo de baja en Just.`,
        url: ownerId === "admin" ? "/admin" : "/area/workspace?tab=compras&ptab=inventario",
      }).catch(() => null)
    )
  );

  return NextResponse.json(updated);
}
