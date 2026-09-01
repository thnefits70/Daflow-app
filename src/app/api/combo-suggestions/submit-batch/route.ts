import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewComboSuggestions, getMarketingLeadId } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

const schema = z.object({ ids: z.array(z.string().min(1)).min(1) });

const URL_BASE = "/area/workspace?tab=analisis-mercado&otab=combos";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canViewComboSuggestions())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const actorId = session.user.role === "admin" ? null : session.user.id;
  const batchId = `CS-${Date.now()}`;
  const result = await prisma.comboSuggestion.updateMany({
    where: { id: { in: parsed.data.ids }, status: { in: ["SUGERIDO", "SELECCIONADO"] } },
    data: { status: "PENDIENTE_APROBACION", batchId, selectedById: actorId, sentForApprovalAt: new Date() },
  });
  if (result.count === 0) return NextResponse.json({ error: "No había sugerencias válidas para enviar." }, { status: 400 });

  const leadId = await getMarketingLeadId();
  if (leadId) {
    await notifyOwner(leadId, {
      title: "Combos sugeridos pendientes de aprobación",
      body: `${result.count} combo(s) esperando tu revisión.`,
      url: URL_BASE,
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true, batchId, count: result.count });
}
