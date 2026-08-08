import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canConfirmPurchaseReceiving } from "@/lib/guards";
import { compareReceiptPhotos } from "@/lib/purchaseAi";
import { pushOwnerId } from "@/lib/pushOwner";

const schema = z.object({
  requestId: z.string().min(1),
  receivedPhotoUrls: z.array(z.string().url()).min(2).max(3),
});

// Mismo patrón que verify-quote/verify-purchase-order — sin escritura, la IA
// compara UNA vez y el resultado se reutiliza al confirmar la recepción.
// Fix confirmado 2026-08-08: cambio de política — YA NO es puramente
// informativo. El cliente (PurchaseReceivingPanel.tsx) deshabilita el botón
// "Confirmar que llegó" si likelyMatch da false (producto distinto), para
// forzar el uso de "Informar urgente" en vez de confirmar algo que no
// corresponde.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canConfirmPurchaseReceiving()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const request = await prisma.purchaseRequest.findUnique({
    where: { id: parsed.data.requestId },
    select: { catalogItem: { select: { photos: true } } },
  });
  if (!request) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  try {
    const result = await compareReceiptPhotos({
      referencePhotoUrls: request.catalogItem.photos,
      receivedPhotoUrls: parsed.data.receivedPhotoUrls,
      actorId: pushOwnerId(session),
      deptId: session.user.deptId ?? undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo comparar las fotos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
