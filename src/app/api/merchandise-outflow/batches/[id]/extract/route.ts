import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseOutflow } from "@/lib/guards";
import { readOutflowManifest } from "@/lib/merchandiseOutflowAi";

const MAX_PHOTOS = 40;
const schema = z.object({ photoUrls: z.array(z.string().min(1)).min(1).max(MAX_PHOTOS) });

const CONFIDENCE_RANK = { alta: 2, media: 1, baja: 0 } as const;
type Confidence = keyof typeof CONFIDENCE_RANK;
const RANK_TO_CONFIDENCE: Confidence[] = ["baja", "media", "alta"];

// Daniel sube las fotos de la hoja/manifiesto — la IA arma un consolidado
// SUGERIDO (nunca persistido acá) para que revise fila por fila antes de
// agregarlo de verdad al lote (ver batches/[id]/items). Solo guarda las
// fotos del documento en el lote, como evidencia.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canCaptureMerchandiseOutflow()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const tooMany = parsed.error.issues.some((i) => i.path[0] === "photoUrls" && i.code === "too_big");
    return NextResponse.json({ error: tooMany ? `Máximo ${MAX_PHOTOS} fotos por lote. Quita algunas o envía el resto en un lote aparte.` : "Datos inválidos." }, { status: 400 });
  }

  const batch = await prisma.merchandiseOutflowBatch.findUnique({ where: { id } });
  if (!batch) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (batch.createdById !== session.user.id) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (batch.submittedAt) return NextResponse.json({ error: "Este lote ya fue enviado." }, { status: 409 });
  if (batch.reason !== "DESPACHO" && batch.reason !== "GARANTIA") return NextResponse.json({ error: "Este motivo no usa lectura de documento." }, { status: 400 });

  await prisma.merchandiseOutflowBatch.update({ where: { id }, data: { documentPhotoUrls: parsed.data.photoUrls } });

  const catalog = await prisma.purchaseCatalogItem.findMany({ select: { id: true, name: true, photos: true, justCode: true, pendingRegistration: true } });
  // Confirmado 2026-08-26: solo se confía en un catalogMatch/code de la IA si
  // existe TAL CUAL en el catálogo real (validación del lado del servidor) —
  // evita que un nombre o código inventado/mal copiado por la IA termine
  // vinculado a un producto que no es.
  const catalogByName = new Map(catalog.map((c) => [c.name.trim().toLowerCase(), c]));
  // Confirmado 2026-08-26 (pedido explícito del usuario): el código Just es
  // el MISMO código que usa Dropi, así que si el documento trae ese código
  // junto al renglón (no siempre lo trae), es una identificación exacta del
  // producto — mucho más confiable que comparar el nombre a mano. Se
  // prioriza sobre el match por nombre cuando ambos vienen en la misma fila.
  const catalogByJustCode = new Map(catalog.filter((c) => c.justCode).map((c) => [c.justCode!.trim().toLowerCase(), c]));

  try {
    const result = await readOutflowManifest({
      photoUrls: parsed.data.photoUrls,
      documentKind: batch.reason === "DESPACHO" ? "despacho" : "garantía",
      catalogNames: catalog.map((c) => c.name),
      actorId: session.user.id,
    });

    // Agrupa por el producto de catálogo ya resuelto (o por el nombre crudo
    // si no hubo match) — así dos renglones escritos distinto en el papel
    // pero que la IA emparejó al mismo producto quedan en una sola fila con
    // la cantidad sumada, que es justo el resumen que Daniel necesita ver
    // antes de mandarlo a dar de baja en Just.
    const groups = new Map<string, { name: string; quantity: number; confidence: Confidence; catalogItem: (typeof catalog)[number] | null }>();
    for (const row of result.rows) {
      const matched =
        (row.code ? catalogByJustCode.get(row.code.trim().toLowerCase()) : undefined) ??
        (row.catalogMatch ? catalogByName.get(row.catalogMatch.trim().toLowerCase()) : undefined);
      const key = matched ? `cat:${matched.id}` : `manual:${row.name.trim().toLowerCase()}`;
      const existing = groups.get(key);
      if (existing) {
        existing.quantity += row.quantity;
        existing.confidence = RANK_TO_CONFIDENCE[Math.min(CONFIDENCE_RANK[existing.confidence], CONFIDENCE_RANK[row.confidence])];
      } else {
        groups.set(key, { name: matched ? matched.name : row.name, quantity: row.quantity, confidence: row.confidence, catalogItem: matched ?? null });
      }
    }

    return NextResponse.json({ rows: Array.from(groups.values()) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo leer el documento.", rows: [] }, { status: 200 });
  }
}
