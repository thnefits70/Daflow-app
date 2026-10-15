import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnPurchaseApproval, canActOnPurchaseReceiving } from "@/lib/guards";
import { findCatalogItemByJustCode, moveRequestToOtherId } from "@/lib/purchaseMoveToOtherId";
import { suggestNichoIfMissing } from "@/lib/nichoAi";

// Pedido de Bryan Ríos 2026-10-15 (caso SC-181): "Es otro modelo → pasar a
// otro ID". Lo pueden hacer Bryan (aprueba compras) y Daniel (aprueba
// recepciones), mientras la compra todavía no entra al Kardex. Ver
// lib/purchaseMoveToOtherId.ts.
async function canMove() {
  return (await canActOnPurchaseApproval()) || (await canActOnPurchaseReceiving());
}

// Busca el ID escrito entre los productos que ya existen. Las fotos de lo
// que llegó sirven de punto de partida para un modelo nuevo.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canMove())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const justCode = req.nextUrl.searchParams.get("justCode")?.trim() ?? "";
  const request = await prisma.purchaseRequest.findUnique({ where: { id }, select: { catalogItemId: true, receipt: { select: { photoUrls: true } } } });
  if (!request) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  const existing = justCode ? await findCatalogItemByJustCode(justCode) : null;
  return NextResponse.json({
    existing: existing ? { id: existing.id, name: existing.name, justCode: existing.justCode, photo: existing.photos[0] ?? null, isSame: existing.id === request.catalogItemId } : null,
    receiptPhotos: request.receipt?.photoUrls ?? [],
  });
}

const schema = z.union([
  z.object({ existingCatalogItemId: z.string().min(1) }),
  z.object({
    newItem: z.object({
      name: z.string().trim().min(3, "Escribe el nombre del modelo nuevo."),
      // Mismo mínimo que al crear cualquier producto (purchase-catalog).
      photos: z.array(z.string().url()).min(3, "Agrega mínimo 3 fotos del modelo nuevo.").max(3),
      hasVariants: z.boolean({ message: "Responde si el modelo nuevo lleva variantes." }),
      variantNotes: z.string().trim().max(1000).optional(),
    }),
  }),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canMove())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const result = await moveRequestToOtherId({ requestId: id, target: parsed.data, actorId: session.user.id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  if ("newItem" in parsed.data) after(() => suggestNichoIfMissing(result.catalogItemId));
  return NextResponse.json(result);
}
