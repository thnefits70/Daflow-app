import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewMerchandiseOutflow } from "@/lib/guards";

const BATCH_INCLUDE = {
  createdBy: { select: { name: true } },
  justWrittenOffBy: { select: { name: true } },
  items: {
    include: {
      catalogItem: { select: { name: true, justCode: true } },
      damageReason: { select: { name: true } },
      resolvedBy: { select: { name: true } },
    },
  },
} as const;

// Solo lectura para todo el que tenga acceso al módulo — trazabilidad
// completa, sin límite de antigüedad, excluye borradores sin enviar.
export async function GET() {
  if (!(await canViewMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const batches = await prisma.merchandiseOutflowBatch.findMany({
    where: { submittedAt: { not: null } },
    include: BATCH_INCLUDE,
    orderBy: { submittedAt: "desc" },
  });
  return NextResponse.json(batches);
}
