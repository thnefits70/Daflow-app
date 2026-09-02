import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canApproveMerchandiseReentry } from "@/lib/guards";
import { itemNeedsReview } from "@/lib/merchandiseReentry";

const ITEM_INCLUDE = {
  catalogItem: { select: { id: true, name: true, photos: true, justCode: true, createdBy: { select: { department: { select: { code: true } } } } } },
  damageReason: { select: { name: true } },
} as const;

type RawItem = Awaited<ReturnType<typeof fetchBatches>>[number]["items"][number];

async function fetchBatches() {
  return prisma.merchandiseReentryBatch.findMany({
    where: { submittedAt: { not: null }, danielApprovedAt: null },
    include: {
      createdBy: { select: { name: true } },
      items: { include: ITEM_INCLUDE, orderBy: { createdAt: "asc" } },
    },
    orderBy: { submittedAt: "asc" },
  });
}

// Confirmado 2026-09-02: marca los productos que un chico de Inventario
// registró a mano antes del cierre del 24 de agosto (createdBy en el
// departamento INV) — son los únicos que Daniel puede corregir/eliminar
// directo desde Revisión (ver ReviewInbox), nunca un producto matriculado de
// verdad por Compras. Se calcula acá y se manda ya resuelto como booleano —
// el creador real no se expone al cliente.
function toItemDTO(item: RawItem) {
  const { catalogItem, ...rest } = item;
  return {
    ...rest,
    catalogItem: catalogItem
      ? {
          id: catalogItem.id,
          name: catalogItem.name,
          photos: catalogItem.photos,
          justCode: catalogItem.justCode,
          legacyInventoryName: catalogItem.createdBy?.department?.code === "INV",
        }
      : null,
  };
}

// Bandeja de Daniel: lotes ya enviados y todavía no aprobados del todo,
// separados en "listos" (ningún item necesita revisión) vs "revisión"
// (al menos uno sí) — la clasificación es del lote completo, no por item,
// para que coincida con las dos pestañas del boceto aprobado.
export async function GET() {
  if (!(await canApproveMerchandiseReentry())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const batches = await fetchBatches();

  const ready = batches.filter((b) => b.items.every((i) => !itemNeedsReview(i))).map((b) => ({ ...b, items: b.items.map(toItemDTO) }));
  const needsReview = batches.filter((b) => b.items.some((i) => itemNeedsReview(i))).map((b) => ({ ...b, items: b.items.map(toItemDTO) }));

  return NextResponse.json({ ready, needsReview });
}
