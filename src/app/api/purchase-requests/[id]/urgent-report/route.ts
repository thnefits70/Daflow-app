import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canConfirmPurchaseReceiving } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";
import { isWithinCreditClaimWindow } from "@/lib/purchaseUrgent";

const schema = z.object({
  damagedQty: z.number().int().nonnegative().default(0),
  missingQty: z.number().int().nonnegative().default(0),
  incompleteQty: z.number().int().nonnegative().default(0),
  description: z.string().trim().min(1, "Describe brevemente qué pasó."),
  mediaUrls: z.array(z.string().url()).min(1, "Sube al menos una foto de evidencia.").max(4),
});

// Confirmado 2026-08-06: Daniel (líder de Inventario) desglosa la cantidad
// por tipo (dañada/faltante/incompleta) y sube evidencia (mínimo 1 foto,
// puede agregar 1 video) — el valor en disputa se calcula solo con el
// costo real de la cotización, nunca un monto escrito a mano.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canConfirmPurchaseReceiving()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const totalAffected = parsed.data.damagedQty + parsed.data.missingQty + parsed.data.incompleteQty;
  if (totalAffected <= 0) {
    return NextResponse.json({ error: "Ingresa al menos una cantidad afectada (dañada, faltante o incompleta)." }, { status: 400 });
  }

  const existing = await prisma.purchaseRequest.findUnique({ where: { id }, include: { catalogItem: { select: { name: true } } } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (totalAffected > existing.quantity) {
    return NextResponse.json({ error: `No puede ser mayor a lo pedido (${existing.quantity} un.).` }, { status: 400 });
  }

  const isAdmin = session.user.role === "admin";
  const report = await prisma.purchaseRequestUrgentReport.create({
    data: {
      requestId: id,
      damagedQty: parsed.data.damagedQty,
      missingQty: parsed.data.missingQty,
      incompleteQty: parsed.data.incompleteQty,
      description: parsed.data.description,
      mediaUrls: parsed.data.mediaUrls,
      reportedById: isAdmin ? null : session.user.id,
    },
  });

  const disputedValue = totalAffected * existing.unitCost;
  // Confirmado 2026-08-06: el proveedor solo aprueba crédito si se reclama
  // dentro de los 7 días desde el pago — no bloquea el reporte (la
  // evidencia siempre se puede dejar), solo avisa desde ya si ese plazo ya
  // pasó, para que Bryan lo sepa antes de intentar pedir crédito.
  const withinCreditWindow = existing.paidAt ? isWithinCreditClaimWindow(existing.paidAt) : true;
  const notifyTargets = new Set<string>(["admin"]);
  if (existing.requestedById) notifyTargets.add(existing.requestedById);

  const windowNote = withinCreditWindow ? "" : " · ⚠️ ya pasaron 7 días desde el pago, el proveedor puede no aprobar crédito";
  await Promise.all(
    [...notifyTargets].map((ownerId) =>
      sendPushToOwner(ownerId, {
        title: "🚨 Reporte urgente de mercadería",
        body: `${existing.catalogItem.name} — ${totalAffected} un. afectadas · $${disputedValue.toFixed(2)} en disputa${windowNote}`,
        url: ownerId === "admin" ? "/admin" : "/area/workspace",
      }).catch(() => null)
    )
  );

  return NextResponse.json({ ...report, withinCreditWindow }, { status: 201 });
}
