import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseReentry } from "@/lib/guards";
import { nextMerchandiseReentryNumber, formatMerchandiseReentryCode } from "@/lib/merchandiseReentry";

const ITEM_INCLUDE = { catalogItem: { select: { name: true, photos: true } }, damageReason: { select: { name: true } } } as const;

// El lote sin enviar (submittedAt null) del usuario actual — como mucho uno
// a la vez. La pantalla de captura llama esto primero para retomar un lote a
// medio hacer en vez de perderlo si se cerró la app.
export async function GET() {
  const session = await auth();
  if (!(await canCaptureMerchandiseReentry()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const draft = await prisma.merchandiseReentryBatch.findFirst({
    where: { createdById: session.user.id, submittedAt: null },
    include: { items: { include: ITEM_INCLUDE, orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(draft);
}

// Confirmado 2026-08-19: el lote SOLO existe si el candado inicial se
// respondió Sí — no hay "crear en No", el cliente ni siquiera llama esto
// hasta que el colaborador confirmó que ya está escaneado como devolución.
export async function POST() {
  const session = await auth();
  if (!(await canCaptureMerchandiseReentry()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const existingDraft = await prisma.merchandiseReentryBatch.findFirst({
    where: { createdById: session.user.id, submittedAt: null },
  });
  if (existingDraft) return NextResponse.json(existingDraft);

  const batchNumber = await nextMerchandiseReentryNumber();
  const batch = await prisma.merchandiseReentryBatch.create({
    data: { code: formatMerchandiseReentryCode(batchNumber), batchNumber, createdById: session.user.id },
  });
  return NextResponse.json(batch);
}
