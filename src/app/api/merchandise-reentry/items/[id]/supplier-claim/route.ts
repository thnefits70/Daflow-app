import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseReentry } from "@/lib/guards";
import { claimReentryDamageToSupplier, findReentryClaimLinkCandidates, ReentryClaimError } from "@/lib/reentrySupplierClaim";

// Confirmado 2026-09-24, pedido de Nairoby: Daniel aclara que una
// devolución dañada no es baja sino reclamo al proveedor ("No es baja: se
// reclamó al proveedor"). GET: reportes de deterioro del mismo producto con
// los que se puede unir (si ya lo había registrado ahí). POST: lo pasa.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canActOnMerchandiseReentry())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const item = await prisma.merchandiseReentryItem.findUnique({ where: { id }, select: { catalogItemId: true, damagedQty: true } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  return NextResponse.json({ candidates: await findReentryClaimLinkCandidates(item) });
}

const schema = z.object({ linkOutflowItemId: z.string().nullable().optional(), note: z.string().trim().max(1000).optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canActOnMerchandiseReentry())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  try {
    const result = await claimReentryDamageToSupplier({
      reentryItemId: id,
      actorId: session.user.id,
      actorName: session.user.name ?? "Daniel",
      linkOutflowItemId: parsed.data.linkOutflowItemId ?? null,
      note: parsed.data.note ?? null,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ReentryClaimError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
