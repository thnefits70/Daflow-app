import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewMerchandiseReentry } from "@/lib/guards";

const ITEM_INCLUDE = {
  catalogItem: { select: { name: true, photos: true, justCode: true } },
  damageReason: { select: { name: true } },
  correctedBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
  damageConfirmedBy: { select: { name: true } },
  justUploadedBy: { select: { name: true } },
  writeOffBy: { select: { name: true } },
} as const;

// Historial de solo lectura — cualquier lote ya enviado (esté o no
// completamente cerrado), con la traza completa de cada paso. Sin límite de
// historial, igual criterio que el resto de los módulos de esta app.
export async function GET() {
  if (!(await canViewMerchandiseReentry())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const batches = await prisma.merchandiseReentryBatch.findMany({
    where: { submittedAt: { not: null } },
    include: {
      createdBy: { select: { name: true } },
      items: { include: ITEM_INCLUDE, orderBy: { createdAt: "asc" } },
    },
    orderBy: { submittedAt: "desc" },
  });

  return NextResponse.json(batches);
}
