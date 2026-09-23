import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canBrandNewIds } from "@/lib/newIdBranding";

const schema = z
  .object({
    catalogItemId: z.string().min(1).nullable().optional(),
    proposalId: z.string().min(1).nullable().optional(),
    uploaded: z.boolean(),
  })
  .refine((d) => d.catalogItemId || d.proposalId, { message: "Falta el producto." });

// Confirmado 2026-09-23, pedido de Robert: casilla "ya subido al canal de la
// marca" en el historial. Solo quien brandea puede marcarla (o desmarcarla si
// se equivocó). Para productos brandeados antes de esta sección crea la fila
// sin fotos; el historial sigue mostrando la confirmación vieja.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canBrandNewIds())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const catalogItemId = parsed.data.catalogItemId ?? null;
  const proposalId = catalogItemId ? null : parsed.data.proposalId ?? null;

  const data = parsed.data.uploaded
    ? { channelUploadedAt: new Date(), channelUploadedById: session.user.id }
    : { channelUploadedAt: null, channelUploadedById: null };

  const existing = await prisma.newIdBranding.findFirst({ where: catalogItemId ? { catalogItemId } : { proposalId } });
  if (existing) {
    await prisma.newIdBranding.update({ where: { id: existing.id }, data });
  } else {
    await prisma.newIdBranding.create({ data: { catalogItemId, proposalId, photos: [], videoUrls: [], ...data } });
  }
  return NextResponse.json({ ok: true });
}
