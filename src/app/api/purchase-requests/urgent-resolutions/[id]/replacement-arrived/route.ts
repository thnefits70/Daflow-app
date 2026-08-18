import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canReceivePurchasesTeam } from "@/lib/guards";
import { compareReceiptPhotos } from "@/lib/purchaseAi";
import { pushOwnerId } from "@/lib/pushOwner";

const schema = z.object({ photoUrls: z.array(z.string().url()).min(2).max(3) });

// Confirmado 2026-08-06 (ampliado 2026-08-18): cuando llega el cambio de
// mercadería, cualquiera del equipo de Inventario lo sube con la MISMA
// metodología que una recepción normal (2-3 fotos + comparación por IA
// contra las fotos de referencia del catálogo) — pedido explícito del
// usuario: esto ya no es exclusivo de Daniel. El status se queda en PENDING
// (todavía no COMPLETED) hasta que Daniel dé la aprobación final (ver
// approve-replacement/route.ts) — replacementSubmittedAt es el sello de que
// el equipo ya lo subió.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canReceivePurchasesTeam()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const resolution = await prisma.purchaseUrgentResolution.findUnique({
    where: { id },
    include: { report: { include: { request: { select: { deptId: true, catalogItem: { select: { photos: true } } } } } } },
  });
  if (!resolution || resolution.type !== "REPLACEMENT") return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (resolution.status !== "PENDING") return NextResponse.json({ error: "Ya fue verificada." }, { status: 409 });
  if (resolution.replacementSubmittedAt) return NextResponse.json({ error: "Ya fue enviada — pendiente de aprobación de Daniel." }, { status: 409 });

  let aiResult: { likelyMatch: boolean | null; note: string } | null = null;
  try {
    aiResult = await compareReceiptPhotos({
      referencePhotoUrls: resolution.report.request.catalogItem.photos,
      receivedPhotoUrls: parsed.data.photoUrls,
      actorId: pushOwnerId(session),
      deptId: resolution.report.request.deptId,
    });
  } catch {
    // No bloquea — si la IA falla, se sigue pudiendo enviar a mano.
  }

  const isAdmin = session.user.role === "admin";
  const updated = await prisma.purchaseUrgentResolution.update({
    where: { id },
    data: {
      replacementPhotoUrls: parsed.data.photoUrls,
      replacementAiMatch: aiResult?.likelyMatch ?? null,
      replacementAiNote: aiResult?.note ?? null,
      replacementSubmittedById: isAdmin ? null : session.user.id,
      replacementSubmittedAt: new Date(),
    },
  });

  return NextResponse.json(updated);
}
