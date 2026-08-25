import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canReceivePurchasesTeam, getInventoryLeadId } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";
import { nextLateClaimNumber, formatLateClaimCode } from "@/lib/lateDamageClaims";

const schema = z.object({
  damagedQty: z.number().int().positive(),
  stockStatus: z.enum(["IN_STOCK", "SOLD"]),
  whyNotDetected: z.string().trim().min(1, "Explica por qué no se detectó al recibir."),
  mediaUrls: z.array(z.string().url()).min(1, "Sube al menos una foto de evidencia.").max(4),
  originUncertain: z.boolean(),
  estimatedUnitCost: z.number().positive().optional(),
});

// Confirmado 2026-08-25: "Reclamo posterior al cierre" — reportar daño
// descubierto DÍAS después de que la mercadería ya se confirmó RECIBIDA
// (ej. al despachar). Sin plazo límite (decisión explícita del usuario,
// distinto del aviso de 7 días de "Informar urgente"). :id es la solicitud
// de compra ya RECIBIDA elegida como origen más probable — si Inventario no
// puede saberlo con certeza, sigue siendo el ancla técnica pero
// originUncertain=true hace que el valor en disputa use estimatedUnitCost
// (promedio de compras recientes) en vez de su unitCost puntual.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canReceivePurchasesTeam()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const isAdmin = session.user.role === "admin";

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  if (parsed.data.originUncertain && !parsed.data.estimatedUnitCost) {
    return NextResponse.json({ error: "Falta el costo promedio." }, { status: 400 });
  }

  const existing = await prisma.purchaseRequest.findUnique({ where: { id }, include: { catalogItem: { select: { name: true } } } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.status !== "RECEIVED") return NextResponse.json({ error: "Solo se puede reportar sobre mercadería ya recibida." }, { status: 400 });
  if (parsed.data.damagedQty > existing.quantity) {
    return NextResponse.json({ error: `No puede ser mayor a lo recibido (${existing.quantity} un.).` }, { status: 400 });
  }

  const claimNumber = await nextLateClaimNumber();
  const claim = await prisma.purchaseRequestUrgentReport.create({
    data: {
      requestId: id,
      isLateClaim: true,
      lateClaimCode: formatLateClaimCode(claimNumber),
      damagedQty: parsed.data.damagedQty,
      description: parsed.data.whyNotDetected,
      mediaUrls: parsed.data.mediaUrls,
      originUncertain: parsed.data.originUncertain,
      estimatedUnitCost: parsed.data.originUncertain ? parsed.data.estimatedUnitCost : null,
      stockStatus: parsed.data.stockStatus,
      reportedById: isAdmin ? null : session.user.id,
    },
  });

  const leadId = await getInventoryLeadId();
  if (leadId) {
    await sendPushToOwner(leadId, {
      title: "📦 Reclamo posterior al cierre pendiente de tu revisión",
      body: `${existing.catalogItem.name} — ${parsed.data.damagedQty} un. · ${claim.lateClaimCode}`,
      url: "/area/workspace?tab=compras&ptab=inventario",
    }).catch(() => null);
  }

  return NextResponse.json(claim, { status: 201 });
}
