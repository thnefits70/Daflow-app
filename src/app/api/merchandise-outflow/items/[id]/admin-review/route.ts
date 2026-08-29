import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canReviewSupplierExchangeRejection } from "@/lib/guards";

// Confirmado 2026-08-28, pedido explícito del usuario: registro de auditoría
// del admin sobre un rechazo total del proveedor — comentario opcional, no
// gatea a Nairoby (finance-writeoff) ni a Daniel (just-writeoff-confirm),
// que siguen pudiendo confirmar su parte antes, después o sin que esto exista.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canReviewSupplierExchangeRejection())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 1000) : "";

  const item = await prisma.merchandiseOutflowItem.findUnique({ where: { id }, select: { resolution: true, adminReviewedAt: true } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (item.resolution !== "REJECTED") return NextResponse.json({ error: "Este ítem no fue rechazado por el proveedor." }, { status: 400 });
  if (item.adminReviewedAt) return NextResponse.json({ error: "Ya quedó revisado." }, { status: 409 });

  // session.user.id es el string literal "admin" cuando se entra por el
  // login especial de admin (ver auth.ts) — no existe una fila de User con
  // ese id, así que guardarlo tal cual rompe la foreign key de
  // adminReviewedById. Mismo patrón que rejectedById/reviewedByLeadId en
  // late-claims/review/route.ts.
  const updated = await prisma.merchandiseOutflowItem.update({
    where: { id },
    data: { adminReviewedAt: new Date(), adminReviewedById: session.user.id === "admin" ? null : session.user.id, adminReviewNote: note || null },
  });
  return NextResponse.json(updated);
}
