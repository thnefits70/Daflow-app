import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canDecidePurchaseException, dbUserId } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { notifyInventoryLeadDeteriorPurchaseResolved, outflowItemDisplayName } from "@/lib/merchandiseOutflow";

const schema = z.object({
  approve: z.boolean(),
  note: z.string().trim().optional(),
});

// Confirmado 2026-09-28, pedido explícito del usuario: admin aprueba (o
// devuelve) lo que Jariel pidió registrar SIN captura con CHEN (ver
// purchase-no-proof-request/route.ts). Aprobar recién ahí cierra el reclamo
// igual que purchase-resolve (crédito AVAILABLE o rechazo) — Jariel queda
// como quien lo gestionó, y la aprobación de admin queda guardada aparte.
// Devolver deja el reclamo abierto para que Jariel lo vuelva a intentar.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canDecidePurchaseException())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const note = parsed.data.note || null;
  if (!parsed.data.approve && !note) return NextResponse.json({ error: "Explica por qué lo devuelves." }, { status: 400 });

  const item = await prisma.merchandiseOutflowItem.findUnique({ where: { id }, include: { catalogItem: { select: { name: true } } } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!item.noProofRequestedAt || item.noProofDecidedAt) return NextResponse.json({ error: "Este pedido ya fue decidido." }, { status: 409 });
  if (item.purchaseResolution) return NextResponse.json({ error: "Este reclamo ya fue resuelto." }, { status: 409 });
  const resolution = item.noProofResolution;
  if (resolution !== "CREDIT_ISSUED" && resolution !== "REJECTED") return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });

  const now = new Date();
  const name = outflowItemDisplayName(item);

  await prisma.$transaction(async (tx) => {
    await tx.merchandiseOutflowItem.update({
      where: { id },
      data: {
        noProofApproved: parsed.data.approve,
        noProofDecisionNote: note,
        noProofDecidedAt: now,
        noProofDecidedById: dbUserId(session.user.id),
        ...(parsed.data.approve
          ? {
              purchaseResolution: resolution,
              purchaseResolutionNote: `Sin captura (acordado por llamada o en persona): ${item.noProofNote}`,
              purchaseResolvedAt: now,
              purchaseResolvedById: item.noProofRequestedById,
            }
          : {}),
      },
    });
    if (parsed.data.approve && resolution === "CREDIT_ISSUED") {
      if (!item.purchaseGestionSupplierId || !item.noProofAmount) throw new Error("Falta el proveedor o el monto.");
      await tx.supplierCredit.create({
        data: {
          supplierId: item.purchaseGestionSupplierId,
          amount: item.noProofAmount,
          reason: `Deterioro escalado — ${item.declaredName}`,
          proofUrl: null,
          proofMismatchNote: `Sin captura (acordado por llamada o en persona), aprobado por admin. Explicación: ${item.noProofNote}${note ? `\nAdmin: ${note}` : ""}`,
          status: "AVAILABLE",
          outflowItemId: id,
          createdById: item.noProofRequestedById,
        },
      });
    }
  });

  if (item.noProofRequestedById) {
    await notifyOwner(item.noProofRequestedById, {
      title: parsed.data.approve ? "✅ Admin aprobó tu reclamo sin captura" : "↩️ Admin te devolvió un reclamo sin captura",
      body: `${name} — ${parsed.data.approve ? "ya quedó registrado" : "vuelve a revisarlo"}.${note ? ` Nota: ${note}` : ""}`,
      url: "/area/workspace?tab=egresos&otab=proveedor",
    }).catch(() => null);
  }
  if (parsed.data.approve) {
    await notifyInventoryLeadDeteriorPurchaseResolved({
      declaredName: name,
      quantity: item.quantity,
      resolution,
      creditAmount: resolution === "CREDIT_ISSUED" ? item.noProofAmount : null,
    });
  }

  return NextResponse.json({ ok: true });
}
