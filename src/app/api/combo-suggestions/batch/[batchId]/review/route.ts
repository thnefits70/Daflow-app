import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canApproveComboSuggestions } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

const schema = z.object({ action: z.enum(["approve", "reject"]), rejectReason: z.string().trim().optional() });

const URL_BASE = "/area/workspace?tab=analisis-mercado&otab=combos";

// Confirmado 2026-08-31: el líder de Análisis de Mercado (hoy Bryan Ríos)
// aprueba o rechaza TODO el lote junto — mismo criterio que la revisión por
// groupId de Control de Compras.
export async function POST(req: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const session = await auth();
  if (!session || !(await canApproveComboSuggestions())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { batchId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const rows = await prisma.comboSuggestion.findMany({ where: { batchId } });
  if (rows.length === 0) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (rows.some((r) => r.status !== "PENDIENTE_APROBACION")) return NextResponse.json({ error: "Ya fue revisado." }, { status: 409 });

  const reviewerId = session.user.role === "admin" ? null : session.user.id;
  await prisma.comboSuggestion.updateMany({
    where: { batchId },
    data:
      parsed.data.action === "approve"
        ? { status: "APROBADO", reviewedById: reviewerId, reviewedAt: new Date() }
        : { status: "RECHAZADO", rejectReason: parsed.data.rejectReason, reviewedById: reviewerId, reviewedAt: new Date() },
  });

  const selectedById = rows[0].selectedById;
  if (selectedById) {
    await notifyOwner(selectedById, {
      title: parsed.data.action === "approve" ? "Lote de combos aprobado" : "Lote de combos rechazado",
      body:
        parsed.data.action === "approve"
          ? `${rows.length} combo(s) aprobados — ya pueden crearse en Dropi.`
          : `${rows.length} combo(s) rechazados — ${parsed.data.rejectReason || "sin motivo especificado"}`,
      url: URL_BASE,
    }).catch(() => null);
  }

  const updated = await prisma.comboSuggestion.findMany({ where: { batchId } });
  return NextResponse.json(updated);
}
