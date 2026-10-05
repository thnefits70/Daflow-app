import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow, canAssignExternalSalePack } from "@/lib/guards";

// Pedido de Daniel 2026-10-05 (aprobado por el usuario): Agrupar y Embalaje
// en una sola pestaña "Despacho". Cada venta aprobada que todavía no se
// entrega aparece una sola vez con sus 3 pasos (agrupar → preparado con
// foto → embalar y entregar) y quién tiene cada uno. El líder puede elegir
// quién embala desde el principio; a esa persona le llega el aviso recién
// cuando se agrupa (ver prep-ready/route.ts).
export async function GET() {
  const session = await auth();
  const [canPrep, canPack] = await Promise.all([canActOnMerchandiseOutflow(), canAssignExternalSalePack()]);
  if (!session || (!canPrep && !canPack)) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const [sales, groupTeam, packTeam] = await Promise.all([
    prisma.externalSale.findMany({
      where: { reviewStatus: "APPROVED", deliveredAt: null, returnedAt: null, deletedAt: null },
      include: {
        // Garantías: solo lo que sale de bodega (lo que se recoge no está acá).
        items: { where: { OR: [{ warrantyRole: null }, { warrantyRole: "DELIVER" as const }] }, include: { catalogItem: { select: { name: true, photos: true, justCode: true } } }, orderBy: { createdAt: "asc" as const } },
        advisor: { select: { name: true } },
        dispatchAssignedTo: { select: { id: true, name: true } },
        prepReadyBy: { select: { name: true } },
        packAssignedTo: { select: { id: true, name: true } },
        guidePrintedBy: { select: { name: true } },
      },
      orderBy: { reviewedAt: "asc" },
    }),
    // Mismos equipos que antes: agrupar = todo INV; embalar = INV sin el
    // líder (él asigna, nunca entrega él mismo).
    prisma.user.findMany({ where: { department: { code: "INV" }, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { department: { code: "INV" }, isActive: true, isLeader: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ sales, groupTeam, packTeam, meId: session.user.id });
}
