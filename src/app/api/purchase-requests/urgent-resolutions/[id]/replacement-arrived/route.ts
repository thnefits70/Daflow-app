import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnPurchaseReceiving } from "@/lib/guards";
import { compareReceiptPhotos } from "@/lib/purchaseAi";
import { pushOwnerId } from "@/lib/pushOwner";

const schema = z.object({ photoUrls: z.array(z.string().url()).min(2).max(3) });

// Confirmado 2026-08-06: cuando llega el cambio de mercadería, Daniel lo
// verifica con la MISMA metodología que una recepción normal (2-3 fotos +
// comparación por IA contra las fotos de referencia del catálogo) — la IA
// solo da apoyo, Daniel es quien de verdad confirma que llegó bien.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseReceiving()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

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

  let aiResult: { likelyMatch: boolean | null; note: string } | null = null;
  try {
    aiResult = await compareReceiptPhotos({
      referencePhotoUrls: resolution.report.request.catalogItem.photos,
      receivedPhotoUrls: parsed.data.photoUrls,
      actorId: pushOwnerId(session),
      deptId: resolution.report.request.deptId,
    });
  } catch {
    // No bloquea — si la IA falla, Daniel sigue pudiendo confirmar a mano.
  }

  const isAdmin = session.user.role === "admin";
  const updated = await prisma.purchaseUrgentResolution.update({
    where: { id },
    data: {
      status: "COMPLETED",
      replacementArrivedAt: new Date(),
      replacementPhotoUrls: parsed.data.photoUrls,
      replacementAiMatch: aiResult?.likelyMatch ?? null,
      replacementAiNote: aiResult?.note ?? null,
      replacementVerifiedById: isAdmin ? null : session.user.id,
    },
  });

  return NextResponse.json(updated);
}
