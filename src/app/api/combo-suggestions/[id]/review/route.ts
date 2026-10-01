import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnComboSuggestions } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { priceCombos, findRegisteredComboWithFingerprint } from "@/lib/comboSuggestions";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), bodega: z.enum(["MKT_PROVEDIX", "MKT_DAMIAN", "MKT_SHANGHAI"]) }),
  z.object({ action: z.literal("reject"), rejectReason: z.string().trim().optional() }),
]);

const URL_BASE = "/area/workspace?tab=analisis-mercado&otab=combos";

// Pedido del usuario 2026-09-30: el líder de Análisis de Mercado aprueba o
// rechaza CADA combo (ya no el lote entero) y elige UNA marca. Al aprobar se
// congela el precio Dropi calculado en ese momento — es el que la asesora
// B2B copia. Un combo nunca se repite en otra marca: si ya existe registrado
// con la misma receta, no se aprueba.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canActOnComboSuggestions())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const row = await prisma.comboSuggestion.findUnique({ where: { id }, include: { items: { select: { catalogItemId: true, quantity: true } } } });
  if (!row) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (row.status !== "PENDIENTE_APROBACION") return NextResponse.json({ error: "Ya fue revisado." }, { status: 409 });

  const now = new Date();
  if (parsed.data.action === "reject") {
    await prisma.comboSuggestion.update({
      where: { id },
      data: { status: "RECHAZADO", rejectReason: parsed.data.rejectReason || null, reviewedById: session.user.id, reviewedAt: now },
    });
  } else {
    if (row.fingerprint) {
      const dup = await findRegisteredComboWithFingerprint(row.fingerprint);
      if (dup) return NextResponse.json({ error: `Este combo ya existe registrado (ID ${dup.code}). Un combo no se repite en otra marca.` }, { status: 409 });
    }
    const price = (await priceCombos([{ id, parts: row.items }])).get(id)?.dropiPrice ?? null;
    if (price === null) return NextResponse.json({ error: "A un producto de este combo le falta el costo — no se puede aprobar sin precio." }, { status: 409 });
    await prisma.comboSuggestion.update({
      where: { id },
      data: { status: "APROBADO", bodega: parsed.data.bodega, approvedDropiPrice: price, reviewedById: session.user.id, reviewedAt: now },
    });
  }

  if (row.selectedById) {
    const approved = parsed.data.action === "approve";
    await notifyOwner(row.selectedById, {
      title: approved ? "Combo aprobado" : "Combo rechazado",
      body: approved
        ? `${row.suggestedName ?? "Un combo"} — ya puedes copiarlo a Dropi.`
        : `${row.suggestedName ?? "Un combo"} — ${(parsed.data.action === "reject" && parsed.data.rejectReason) || "sin motivo especificado"}`,
      url: URL_BASE,
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true });
}
