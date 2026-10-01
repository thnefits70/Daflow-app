import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canMarkComboCreatedInDropi } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { comboCodeUsedByProduct } from "@/lib/comboBrand";
import { componentsMissingDropiId, missingDropiIdMessage } from "@/lib/fulfillmentGuides";
import { findRegisteredComboWithFingerprint } from "@/lib/comboSuggestions";
import { getNewIdBrandingActorIds } from "@/lib/newIdBranding";

const schema = z.object({ dropiCode: z.string().trim().min(1, "Escribe el ID que te dio Dropi.") });

// Pedido del usuario 2026-09-30: al pegar el ID que dio Dropi, el combo
// queda registrado SOLO en Stock Actual — con el nombre sugerido, la marca
// que eligió el líder de Análisis de Mercado y la receta aprobada (nunca se
// adivina: es exactamente el combo aprobado). Desde ahí los cortes ya lo
// reconocen, Stock Actual muestra su "≈ N" y entra a "Nuevos IDs por
// brandear" con aviso a quien brandea. La asesora B2B no cambia nada del
// combo, solo escribe el ID. Exclusivo de quien tiene el flag (ni admin).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canMarkComboCreatedInDropi())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const code = parsed.data.dropiCode;

  const { id } = await params;
  const existing = await prisma.comboSuggestion.findUnique({ where: { id }, include: { items: true } });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (existing.status !== "APROBADO") return NextResponse.json({ error: "Este combo todavía no está aprobado." }, { status: 409 });

  if (await prisma.dropiCombo.findUnique({ where: { code }, select: { id: true } })) {
    return NextResponse.json({ error: `El ID ${code} ya está registrado como otro combo.` }, { status: 409 });
  }
  const clash = await comboCodeUsedByProduct(code);
  if (clash) return NextResponse.json({ error: clash }, { status: 409 });
  const missingIds = await componentsMissingDropiId(existing.items.map((i) => i.catalogItemId));
  if (missingIds.length > 0) return NextResponse.json({ error: missingDropiIdMessage(missingIds) }, { status: 400 });
  if (existing.fingerprint) {
    const dup = await findRegisteredComboWithFingerprint(existing.fingerprint);
    if (dup) return NextResponse.json({ error: `Este combo ya existe registrado (ID ${dup.code}). Un combo no se repite en otra marca.` }, { status: 409 });
  }

  const now = new Date();
  const combo = await prisma.$transaction(async (tx) => {
    const created = await tx.dropiCombo.create({
      data: {
        code,
        label: existing.suggestedName,
        bodega: existing.bodega,
        createdById: session.user.id,
        components: { create: existing.items.map((i) => ({ catalogItemId: i.catalogItemId, quantity: i.quantity })) },
      },
    });
    await tx.comboSuggestion.update({
      where: { id },
      data: { status: "CREADO_EN_DROPI", createdInDropiAt: now, createdInDropiById: session.user.id, dropiComboId: created.id },
    });
    await tx.newIdBranding.create({ data: { dropiComboId: created.id } });
    return created;
  });

  const brandUserIds = await getNewIdBrandingActorIds();
  await Promise.all(
    brandUserIds.map((uid) =>
      notifyOwner(uid, {
        title: "Nuevo combo para brandear",
        body: `${combo.label ?? "Combo"} — ID Dropi ${code}. Brandéalo en Dropi y el Drive, y marca los pasos en DAFLOW.`,
        url: "/area/workspace?tab=nuevos-ids",
      }).catch(() => null)
    )
  );

  return NextResponse.json({ ok: true, code });
}
