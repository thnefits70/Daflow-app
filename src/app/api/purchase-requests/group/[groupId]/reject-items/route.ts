import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { notifyOwner } from "@/lib/notifications";
import { releaseCreditsForGroup, getReservedCreditsForGroup } from "@/lib/supplierCredits";
import { canActOnPurchaseApproval } from "@/lib/guards";
import { cancelMarketProposal } from "@/lib/marketProposalCancel";
import { formatPurchaseRequestCode } from "@/lib/purchases";

const schema = z.object({
  rowIds: z.array(z.string()).min(1, "Marca al menos un producto."),
  rejectReason: z.string().trim().optional(),
  cancelProposalCatalogItemIds: z.array(z.string()).optional(),
});

// Pedido del usuario 2026-10-03: Bryan puede rechazar SOLO algunos productos
// de una solicitud con varios (antes era todo o nada, ver review/route.ts).
// Los rechazados se SEPARAN a un groupId nuevo (rechazado, mismo SC, Jariel
// lo puede reenviar como cualquier rechazo) y el resto sigue en la solicitud
// PENDIENTE — Bryan la aprueba después como siempre. Así cada grupo sigue
// siendo todo de un mismo estado y el pago, crédito y revisión IA no cambian.
// Rechazar todos los productos sigue siendo la ruta review (action reject).
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const rows = await prisma.purchaseRequest.findMany({ where: { groupId }, include: { catalogItem: { select: { name: true } } } });
  if (rows.length === 0) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (rows.some((r) => r.status !== "PENDING_APPROVAL")) return NextResponse.json({ error: "Ya fue revisada." }, { status: 409 });

  const authorized = rows.some((r) => r.isEmergency) ? session.user.role === "admin" : await canActOnPurchaseApproval();
  if (!authorized) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const rejectIds = new Set(parsed.data.rowIds);
  const rejected = rows.filter((r) => rejectIds.has(r.id));
  const kept = rows.filter((r) => !rejectIds.has(r.id));
  if (rejected.length !== rejectIds.size) return NextResponse.json({ error: "Algún producto no es de esta solicitud." }, { status: 400 });
  if (kept.length === 0) return NextResponse.json({ error: "Marcaste todos — usa Rechazar toda la solicitud." }, { status: 400 });

  const actorId = session.user.role === "admin" ? null : session.user.id;
  const newGroupId = randomUUID();
  await prisma.$transaction([
    prisma.purchaseRequest.updateMany({
      where: { id: { in: rejected.map((r) => r.id) } },
      data: { groupId: newGroupId, status: "REJECTED", rejectReason: parsed.data.rejectReason, reviewedById: actorId, reviewedAt: new Date() },
    }),
    // El total leído de la cotización era de TODOS los productos. Pedido del
    // usuario 2026-10-03: se sigue comparando, pero contra la cotización
    // MENOS lo rechazado (ej. $100 − casco $25 = $75), así la revisión IA al
    // aprobar sigue detectando una diferencia real en lo que queda.
    prisma.purchaseRequest.updateMany({
      where: { groupId },
      data: {
        quoteReadTotal:
          rows[0].quoteReadTotal == null ? null : Math.round((rows[0].quoteReadTotal - rejected.reduce((s, r) => s + r.totalCost, 0)) * 100) / 100,
      },
    }),
  ]);

  // Si el crédito reservado ya supera lo que queda por pagar, se libera
  // completo (vuelve a quedar disponible con el proveedor) en vez de dejar
  // un neto negativo.
  const keptTotal = kept.reduce((s, r) => s + r.totalCost, 0);
  const reserved = (await getReservedCreditsForGroup(groupId)).reduce((s, c) => s + c.amount, 0);
  if (reserved > keptTotal + 0.001) await releaseCreditsForGroup(groupId);

  if (parsed.data.cancelProposalCatalogItemIds?.length) {
    const ids = parsed.data.cancelProposalCatalogItemIds.filter((id) => rejected.some((r) => r.catalogItemId === id));
    const proposals = await prisma.marketProductProposal.findMany({ where: { catalogItemId: { in: ids }, status: "APPROVED" }, select: { id: true } });
    const reason = parsed.data.rejectReason || "Compra rechazada — el producto ya no va";
    for (const p of proposals) {
      await cancelMarketProposal({ proposalId: p.id, reason, actorUserId: actorId }).catch(() => null);
    }
  }

  if (rows[0].requestedById) {
    const code = rows[0].requestNumber ? `${formatPurchaseRequestCode(rows[0].requestNumber)}: ` : "";
    await notifyOwner(rows[0].requestedById, {
      title: "Productos rechazados de tu solicitud",
      body: `${code}${rejected.map((r) => r.catalogItem.name).join(", ")} — ${parsed.data.rejectReason || "sin motivo especificado"}. El resto sigue en aprobación.`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true, rejected: rejected.length, kept: kept.length });
}
