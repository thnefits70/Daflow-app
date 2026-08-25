import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageCancelledGuideCutoff } from "@/lib/guards";
import { notifyInventoryLeadCancelledGuideConfirmed } from "@/lib/cancelledGuides";

const schema = z.object({ reallyCancelled: z.boolean() });

// Bryan decide, guía por guía: realmente no se despachó (entra a la cola de
// Daniel para reingresar a Just), o se despachó igual por otro motivo (se
// cierra sin más gestión). Esto no lo puede saber el sistema solo.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canManageCancelledGuideCutoff()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const report = await prisma.cancelledGuideReport.findUnique({ where: { id }, select: { reallyCancelled: true, code: true } });
  if (!report) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (report.reallyCancelled !== null) return NextResponse.json({ error: "Ya fue decidido." }, { status: 409 });

  const updated = await prisma.cancelledGuideReport.update({
    where: { id },
    data: { reallyCancelled: parsed.data.reallyCancelled, cutoffDecidedAt: new Date(), cutoffDecidedById: session.user.id },
  });

  if (parsed.data.reallyCancelled) await notifyInventoryLeadCancelledGuideConfirmed(report.code);
  return NextResponse.json(updated);
}
