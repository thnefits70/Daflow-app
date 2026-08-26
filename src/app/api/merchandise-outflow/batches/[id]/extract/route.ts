import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseOutflow } from "@/lib/guards";
import { readOutflowManifest } from "@/lib/merchandiseOutflowAi";

const MAX_PHOTOS = 40;
const schema = z.object({ photoUrls: z.array(z.string().min(1)).min(1).max(MAX_PHOTOS) });

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

  try {
    const result = await readOutflowManifest({
      photoUrls: parsed.data.photoUrls,
      documentKind: batch.reason === "DESPACHO" ? "despacho" : "garantía",
      actorId: session.user.id,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo leer el documento.", rows: [] }, { status: 200 });
  }
}
