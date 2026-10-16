import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canDeclareExternalSales, canManagePettyCashPrincipal, canManagePettyCashSecundaria } from "@/lib/guards";

const itemsSelect = { select: { id: true, declaredProductName: true, quantity: true, catalogItem: { select: { name: true } } } } as const;

// Pedido de Marcos 2026-10-16 (aprobado por el usuario): pestaña
// "Devoluciones" de Ventas Externas para el asesor y para quien paga el
// flete. El asesor ve sus ventas que ya salieron de bodega (para registrar
// la devolución) y en qué va cada devolución. Nairoby (Principal) y Jariel
// (Secundaria) ven los fletes de devoluciones: por pagar (el paquete ya
// volvió a bodega), en camino y pagados hace poco.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const isAdmin = session.user.role === "admin";
  const [isAdvisor, canPrincipal, canSecundaria] = await Promise.all([
    canDeclareExternalSales(),
    canManagePettyCashPrincipal(),
    canManagePettyCashSecundaria(),
  ]);
  const isPayer = canPrincipal || canSecundaria;
  if (!isAdvisor && !isPayer) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);

  const [eligible, myReturns, freights] = await Promise.all([
    isAdvisor && !isAdmin
      ? prisma.externalSale.findMany({
          where: {
            advisorId: session.user.id,
            kind: "SALE",
            deletedAt: null,
            deliveredAt: { not: null },
            returnedAt: null,
            clientReceivedAt: null,
            nairobyClosedAt: null,
          },
          select: { id: true, code: true, pickupPersonName: true, freightCost: true, isContraEntrega: true, deliveredAt: true, client: { select: { name: true } }, items: itemsSelect },
          orderBy: { deliveredAt: "desc" },
        })
      : Promise.resolve([]),
    isAdvisor && !isAdmin
      ? prisma.externalSale.findMany({
          where: { advisorId: session.user.id, kind: "SALE", deletedAt: null, returnedAt: { gte: since } },
          select: {
            id: true, code: true, pickupPersonName: true, returnReason: true, returnedAt: true, returnReceivedAt: true, returnConfirmedAt: true,
            returnFreightCost: true, freightPaidAt: true, freightPaidBy: { select: { name: true } },
            client: { select: { name: true } }, items: itemsSelect,
            freightPettyCashEntries: { where: { archived: false }, select: { proofUrl: true }, orderBy: { createdAt: "desc" }, take: 1 },
          },
          orderBy: { returnedAt: "desc" },
        })
      : Promise.resolve([]),
    isPayer
      ? prisma.externalSale.findMany({
          where: {
            kind: "SALE",
            deletedAt: null,
            returnedAt: { not: null },
            returnFreightCost: { gt: 0 },
            OR: [{ freightPaidAt: null }, { freightPaidAt: { gte: since } }],
          },
          select: {
            id: true, code: true, advisorId: true, pickupPersonName: true, returnReason: true, returnedAt: true, returnReceivedAt: true,
            returnFreightCost: true, freightPaidAt: true, freightPaidBy: { select: { name: true } },
            advisor: { select: { name: true } }, client: { select: { name: true } }, items: itemsSelect,
            freightPettyCashEntries: { where: { archived: false }, select: { proofUrl: true }, orderBy: { createdAt: "desc" }, take: 1 },
          },
          orderBy: { returnedAt: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return NextResponse.json({
    isAdvisor: isAdvisor && !isAdmin,
    // El dueño solo mira; pagan Nairoby o Jariel.
    payBoxes: isAdmin ? [] : [...(canPrincipal ? ["PRINCIPAL"] : []), ...(canSecundaria ? ["SECUNDARIA"] : [])],
    canSeeFreights: isPayer,
    eligible,
    myReturns,
    freights: freights.map(({ advisorId, ...f }) => ({ ...f, isMine: advisorId === session.user.id })),
  });
}
