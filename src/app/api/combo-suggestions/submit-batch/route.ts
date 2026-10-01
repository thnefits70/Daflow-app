import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canMarkComboCreatedInDropi, getMarketingLeadId } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { priceCombos } from "@/lib/comboSuggestions";

const schema = z.object({ ids: z.array(z.string().min(1)).min(1) });

const URL_BASE = "/area/workspace?tab=analisis-mercado&otab=combos";

// Pedido del usuario 2026-09-30: la asesora B2B no cambia nada del combo —
// solo elige cuáles mandar al líder de Análisis de Mercado. Un combo sin
// costo en algún producto no se puede mandar (no se publica con un precio
// inventado).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canMarkComboCreatedInDropi())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const rows = await prisma.comboSuggestion.findMany({
    where: { id: { in: parsed.data.ids }, status: { in: ["SUGERIDO", "SELECCIONADO"] } },
    select: { id: true, items: { select: { catalogItemId: true, quantity: true } } },
  });
  const pricing = await priceCombos(rows.map((r) => ({ id: r.id, parts: r.items })));
  const withoutCost = rows.filter((r) => pricing.get(r.id)?.dropiPrice == null).length;
  if (withoutCost > 0) {
    return NextResponse.json({ error: `${withoutCost} combo(s) tienen un producto sin costo — quítalos de la selección.` }, { status: 409 });
  }

  const batchId = `CS-${Date.now()}`;
  const result = await prisma.comboSuggestion.updateMany({
    where: { id: { in: rows.map((r) => r.id) }, status: { in: ["SUGERIDO", "SELECCIONADO"] } },
    data: { status: "PENDIENTE_APROBACION", batchId, selectedById: session.user.id, sentForApprovalAt: new Date() },
  });
  if (result.count === 0) return NextResponse.json({ error: "No había sugerencias válidas para enviar." }, { status: 400 });

  const leadId = await getMarketingLeadId();
  if (leadId) {
    await notifyOwner(leadId, {
      title: "Combos pendientes de aprobación",
      body: `${result.count} combo(s) esperando tu revisión — elige la marca de cada uno.`,
      url: URL_BASE,
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true, batchId, count: result.count });
}
