import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnPurchaseReceiving } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

const schema = z.object({ confirmedQty: z.number().int() });

// Confirmado 2026-08-25: pedido explícito del usuario — como DAFLOW no
// tiene integración con Just, esto no puede ser un clic ciego. Daniel debe
// re-escribir la cantidad EXACTA que dio de baja en Just; si no coincide
// con justWriteOffQty (fijado al aprobar), se rechaza — el cliente ya
// deshabilita el botón hasta que coincida, pero la validación real es acá.
// Recién con esto confirmado, el reclamo puede pasar a gestión con el
// proveedor (ver el cambio en urgent-reports/route.ts).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseReceiving()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const existing = await prisma.purchaseRequestUrgentReport.findUnique({
    where: { id },
    include: { request: { select: { requestedById: true, catalogItem: { select: { name: true } } } } },
  });
  if (!existing || !existing.isLateClaim) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!existing.reviewedByLeadAt || existing.rejectedAt) return NextResponse.json({ error: "Este reclamo no está aprobado." }, { status: 409 });
  if (existing.justConfirmedAt) return NextResponse.json({ error: "Ya fue confirmado." }, { status: 409 });
  if (parsed.data.confirmedQty !== existing.justWriteOffQty) {
    return NextResponse.json({ error: `Debe ser ${existing.justWriteOffQty} un. — la cantidad aprobada en el reclamo.` }, { status: 400 });
  }

  const isAdmin = session.user.role === "admin";
  const updated = await prisma.purchaseRequestUrgentReport.update({
    where: { id },
    data: { justConfirmedById: isAdmin ? null : session.user.id, justConfirmedAt: new Date() },
  });

  const notifyTargets = new Set<string>(["admin"]);
  if (existing.reportedById) notifyTargets.add(existing.reportedById);
  await Promise.all(
    [...notifyTargets].map((ownerId) =>
      sendPushToOwner(ownerId, {
        title: "📦 Reclamo posterior al cierre — dado de baja en Just",
        body: `${existing.request.catalogItem.name} — ${existing.lateClaimCode}: listo para gestionar con el proveedor.`,
        url: ownerId === "admin" ? "/admin" : "/area/workspace?tab=compras&ptab=urgentes",
      }).catch(() => null)
    )
  );

  return NextResponse.json(updated);
}
