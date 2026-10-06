import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseReentry } from "@/lib/guards";
import { getReentryVariantStatus, setReentryVariants } from "@/lib/variantStock";

// Stock por variante (pedido del usuario 2026-10-06): la etiqueta de la guía
// no trae el color, así que quien escanea dice de qué color/talla son las
// devoluciones buenas de cada producto que tiene lista oficial.
async function ownDraft(id: string, userId: string) {
  const batch = await prisma.merchandiseReentryBatch.findUnique({ where: { id }, select: { createdById: true, submittedAt: true } });
  if (!batch) return NextResponse.json({ error: "Lote no encontrado." }, { status: 404 });
  if (batch.createdById !== userId) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (batch.submittedAt) return NextResponse.json({ error: "Este lote ya fue enviado — no se puede editar." }, { status: 409 });
  return null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canCaptureMerchandiseReentry()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const denied = await ownDraft(id, session.user.id);
  if (denied) return denied;
  return NextResponse.json(await getReentryVariantStatus(id));
}

const schema = z.object({
  catalogItemId: z.string().min(1),
  variants: z.array(z.object({ name: z.string().max(60), qty: z.number().int().min(0) })).max(40),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canCaptureMerchandiseReentry()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const denied = await ownDraft(id, session.user.id);
  if (denied) return denied;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const r = await setReentryVariants(id, parsed.data.catalogItemId, parsed.data.variants);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
