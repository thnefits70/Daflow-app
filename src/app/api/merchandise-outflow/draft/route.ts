import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseOutflow } from "@/lib/guards";
import { nextMerchandiseOutflowNumber, formatMerchandiseOutflowCode } from "@/lib/merchandiseOutflow";

const ITEM_INCLUDE = { catalogItem: { select: { name: true, photos: true } } } as const;

function parseReason(value: string | null): "DESPACHO" | "GARANTIA" | null {
  return value === "DESPACHO" || value === "GARANTIA" ? value : null;
}

// El lote sin enviar (submittedAt null) del usuario actual PARA ESE MOTIVO —
// como mucho uno a la vez por motivo, mismo criterio que Reingreso, para
// retomar un lote a medio hacer en vez de perderlo.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!(await canCaptureMerchandiseOutflow()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const reason = parseReason(req.nextUrl.searchParams.get("reason"));
  if (!reason) return NextResponse.json({ error: "Motivo inválido." }, { status: 400 });

  const draft = await prisma.merchandiseOutflowBatch.findFirst({
    where: { createdById: session.user.id, reason, submittedAt: null },
    include: { items: { include: ITEM_INCLUDE, orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(draft);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canCaptureMerchandiseOutflow()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const reason = parseReason(body?.reason ?? null);
  if (!reason) return NextResponse.json({ error: "Motivo inválido." }, { status: 400 });

  const existingDraft = await prisma.merchandiseOutflowBatch.findFirst({
    where: { createdById: session.user.id, reason, submittedAt: null },
  });
  if (existingDraft) return NextResponse.json(existingDraft);

  const batchNumber = await nextMerchandiseOutflowNumber();
  const batch = await prisma.merchandiseOutflowBatch.create({
    data: { code: formatMerchandiseOutflowCode(batchNumber), batchNumber, reason, createdById: session.user.id },
  });
  return NextResponse.json(batch);
}
