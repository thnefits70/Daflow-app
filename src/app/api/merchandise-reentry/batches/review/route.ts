import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canApproveMerchandiseReentry } from "@/lib/guards";
import { itemNeedsReview } from "@/lib/merchandiseReentry";

const ITEM_INCLUDE = { catalogItem: { select: { name: true, photos: true } }, damageReason: { select: { name: true } } } as const;

// Bandeja de Daniel: lotes ya enviados y todavía no aprobados del todo,
// separados en "listos" (ningún item necesita revisión) vs "revisión"
// (al menos uno sí) — la clasificación es del lote completo, no por item,
// para que coincida con las dos pestañas del boceto aprobado.
export async function GET() {
  if (!(await canApproveMerchandiseReentry())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const batches = await prisma.merchandiseReentryBatch.findMany({
    where: { submittedAt: { not: null }, danielApprovedAt: null },
    include: {
      createdBy: { select: { name: true } },
      items: { include: ITEM_INCLUDE, orderBy: { createdAt: "asc" } },
    },
    orderBy: { submittedAt: "asc" },
  });

  const ready = batches.filter((b) => b.items.every((i) => !itemNeedsReview(i)));
  const needsReview = batches.filter((b) => b.items.some((i) => itemNeedsReview(i)));

  return NextResponse.json({ ready, needsReview });
}
