import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canSubmitFulfillmentRequest } from "@/lib/guards";
import { auth } from "@/auth";
import { cleanRef, getRocketWarrantyRole, rocketWarrantyCode, rocketWarrantyNotices } from "@/lib/rocketWarranty";

const schema = z.discriminatedUnion("action", [
  // Bryan: aprueba o no.
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), note: z.string().trim().min(3, "Escribe el motivo.").max(500) }),
  // Quien la registró (o el admin) mientras no salga.
  z.object({ action: z.literal("cancel") }),
  // Daniel en el corte, solo si NICK no encontró la guía.
  z.object({ action: z.literal("link_guide"), guideNumber: z.string().trim().min(5).max(40) }),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const p = parsed.data;
  const { id } = await params;
  const w = await prisma.rocketWarranty.findUnique({ where: { id } });
  if (!w) return NextResponse.json({ error: "No existe." }, { status: 404 });
  const code = rocketWarrantyCode(w.number);
  const now = new Date();
  const deny = (msg: string) => NextResponse.json({ error: msg }, { status: 403 });
  const open = w.status === "APPROVAL" || w.status === "APPROVED";

  if (p.action === "link_guide") {
    // Quien sube el corte (Daniel o quien tenga ese permiso).
    const session = await auth();
    if (!session || !(await canSubmitFulfillmentRequest())) return deny("Solo quien sube el corte une la guía.");
    if (!open || w.shippedAt) return NextResponse.json({ error: "Esta garantía ya no está abierta." }, { status: 400 });
    if (w.guideNumber) return NextResponse.json({ error: `Ya tiene la guía ${w.guideNumber}.` }, { status: 400 });
    const guide = cleanRef(p.guideNumber);
    const taken = await prisma.rocketWarranty.findFirst({ where: { guideNumber: guide }, select: { number: true } });
    if (taken) return NextResponse.json({ error: `Esa guía ya es de ${rocketWarrantyCode(taken.number)}.` }, { status: 400 });
    await prisma.rocketWarranty.update({ where: { id }, data: { guideNumber: guide, guideLinkedAt: now, guideLinkedBy: session.user.id } });
    return NextResponse.json({ ok: true });
  }

  const role = await getRocketWarrantyRole();
  if (!role) return deny("No autorizado.");
  if (p.action === "approve" || p.action === "reject") {
    if (!role.canApprove) return deny("Solo Bryan aprueba las garantías de Rocket.");
    if (w.status !== "APPROVAL") return NextResponse.json({ error: "Esta garantía ya cambió de estado. Recarga la página." }, { status: 400 });
    // Ya salió en un corte: no tiene sentido rechazarla.
    if (p.action === "reject" && w.shippedAt) return NextResponse.json({ error: "Esta garantía ya salió en un corte; no se puede rechazar." }, { status: 400 });
    const ok = p.action === "approve";
    const note = p.action === "reject" ? p.note : null;
    await prisma.rocketWarranty.update({ where: { id }, data: { status: ok ? "APPROVED" : "REJECTED", reviewedById: role.userId, reviewedAt: now, reviewNote: note } });
    await rocketWarrantyNotices.reviewed(code, w.dropiOrder, ok, w.createdById, note);
    return NextResponse.json({ ok: true });
  }

  // cancel
  if (w.createdById !== role.userId && !role.isAdmin) return deny("Solo quien la registró puede cancelarla.");
  if (!open || w.shippedAt) return NextResponse.json({ error: "Ya salió o ya se cerró; no se puede cancelar." }, { status: 400 });
  await prisma.rocketWarranty.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: now } });
  await rocketWarrantyNotices.cancelled(code);
  return NextResponse.json({ ok: true });
}
