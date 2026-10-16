import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  readVisitor,
  sameOriginRequest,
  hitAllowed,
  tooMany,
} from "@/lib/provedixVisitor";
import { isRatingTool, ratedRecently } from "@/lib/provedixRatings";

// Calificar una herramienta de provedix.com (pedido 2026-10-15). Solo
// registrados; lo que escriben solo lo ve el admin en DAFLOW.

// ¿Se le puede preguntar? No, si ya calificó esa herramienta en 30 días
// (aunque sea desde otro celular).
export async function GET(req: NextRequest) {
  const tool = req.nextUrl.searchParams.get("tool");
  if (!isRatingTool(tool)) return NextResponse.json({ ask: false });
  const { leadId } = await readVisitor(req);
  if (!leadId) return NextResponse.json({ ask: false });
  return NextResponse.json({ ask: !(await ratedRecently(leadId, tool)) });
}

const schema = z.object({
  tool: z.string(),
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(600).optional(),
  allowPublic: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  if (!sameOriginRequest(req))
    return NextResponse.json(
      { error: "Solicitud no permitida." },
      { status: 403 },
    );
  // Límite contra bots (2026-10-16): 10 por hora por conexión.
  if (!hitAllowed(req, "rating", 10, 60 * 60_000)) return tooMany();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isRatingTool(parsed.data.tool))
    return NextResponse.json(
      { error: "Calificación no válida." },
      { status: 400 },
    );
  const { leadId } = await readVisitor(req);
  if (!leadId)
    return NextResponse.json(
      { error: "Regístrate para calificar." },
      { status: 401 },
    );
  const { tool, stars } = parsed.data;
  // Una por herramienta cada 30 días: un doble clic o un robot no infla la nota.
  if (await ratedRecently(leadId, tool)) return NextResponse.json({ ok: true });
  const comment = parsed.data.comment || null;
  await prisma.provedixRating.create({
    data: {
      leadId,
      tool,
      stars,
      comment,
      allowPublic: !!comment && !!parsed.data.allowPublic,
    },
  });
  return NextResponse.json({ ok: true });
}
