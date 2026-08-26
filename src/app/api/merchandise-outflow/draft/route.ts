import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseOutflow, canActOnMerchandiseOutflow } from "@/lib/guards";
import { nextMerchandiseOutflowNumber, formatMerchandiseOutflowCode } from "@/lib/merchandiseOutflow";

const ITEM_INCLUDE = { catalogItem: { select: { name: true, photos: true } } } as const;

type Reason = "DESPACHO" | "GARANTIA" | "CAMBIO_PROVEEDOR";

function parseReason(value: string | null): Reason | null {
  return value === "DESPACHO" || value === "GARANTIA" || value === "CAMBIO_PROVEEDOR" ? value : null;
}

// CAMBIO_PROVEEDOR queda exclusivo de Daniel (canActOnMerchandiseOutflow) —
// mismo criterio que el flujo anterior de un solo producto. Despacho y
// garantía siguen abiertos a cualquiera del equipo de Inventario.
async function canUseDraftReason(reason: Reason): Promise<boolean> {
  if (reason === "CAMBIO_PROVEEDOR") return canActOnMerchandiseOutflow();
  return canCaptureMerchandiseOutflow();
}

// El lote sin enviar (submittedAt null) del usuario actual PARA ESE MOTIVO —
// como mucho uno a la vez por motivo, mismo criterio que Reingreso, para
// retomar un lote a medio hacer en vez de perderlo.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const reason = parseReason(req.nextUrl.searchParams.get("reason"));
  if (!reason) return NextResponse.json({ error: "Motivo inválido." }, { status: 400 });
  if (!(await canUseDraftReason(reason))) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const draft = await prisma.merchandiseOutflowBatch.findFirst({
    where: { createdById: session.user.id, reason, submittedAt: null },
    include: { items: { include: ITEM_INCLUDE, orderBy: { createdAt: "asc" } }, supplier: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(draft);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const reason = parseReason(body?.reason ?? null);
  if (!reason) return NextResponse.json({ error: "Motivo inválido." }, { status: 400 });
  if (!(await canUseDraftReason(reason))) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  let supplierId: string | undefined;
  if (reason === "CAMBIO_PROVEEDOR") {
    supplierId = typeof body?.supplierId === "string" ? body.supplierId : undefined;
    if (!supplierId) return NextResponse.json({ error: "Falta el proveedor." }, { status: 400 });
    const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
    if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado." }, { status: 404 });
  }

  const existingDraft = await prisma.merchandiseOutflowBatch.findFirst({
    where: { createdById: session.user.id, reason, submittedAt: null },
    include: { supplier: { select: { id: true, name: true } } },
  });
  if (existingDraft) return NextResponse.json(existingDraft);

  const batchNumber = await nextMerchandiseOutflowNumber();
  const batch = await prisma.merchandiseOutflowBatch.create({
    data: { code: formatMerchandiseOutflowCode(batchNumber), batchNumber, reason, createdById: session.user.id, supplierId },
    include: { supplier: { select: { id: true, name: true } } },
  });
  return NextResponse.json(batch);
}
