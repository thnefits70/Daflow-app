import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canCloseMerchandiseReentry } from "@/lib/guards";

const ITEM_INCLUDE = { catalogItem: { select: { name: true, photos: true } }, damageReason: { select: { name: true } }, batch: { select: { code: true, danielApprovedAt: true } } } as const;

// Bandeja de Nairoby: dos colas independientes de ITEMS (no de lotes,
// porque un mismo item puede tener una parte buena y otra dañada que se
// cierran por separado) — "para ingresar a Just" y "para dar de baja".
export async function GET() {
  if (!(await canCloseMerchandiseReentry())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const [forJust, forWriteOff] = await Promise.all([
    prisma.merchandiseReentryItem.findMany({
      where: { goodQty: { gt: 0 }, justUploadedAt: null, batch: { danielApprovedAt: { not: null } } },
      include: ITEM_INCLUDE,
      orderBy: { createdAt: "asc" },
    }),
    prisma.merchandiseReentryItem.findMany({
      where: { damagedQty: { gt: 0 }, damageConfirmed: true, writeOffAt: null, batch: { danielApprovedAt: { not: null } } },
      include: ITEM_INCLUDE,
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return NextResponse.json({ forJust, forWriteOff });
}
