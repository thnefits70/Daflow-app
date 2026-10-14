import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  getWarrantyDispatchRole,
  notifyVerifiers,
  resolveNewGuideNotice,
  resolveVerifierNotice,
  userName,
} from "@/lib/warrantyDispatch";

const schema = z.object({ action: z.enum(["handle", "unhandle", "verify"]) });

// handle/unhandle: solo Joao (el visto de "gestionando"; puede quitarlo si
// se equivocó mientras nadie lo haya revisado). verify: Daniel o Allan.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = await getWarrantyDispatchRole();
  if (!role) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const { id } = await params;
  const g = await prisma.warrantyDispatchGuide.findUnique({ where: { id } });
  if (!g) return NextResponse.json({ error: "No existe." }, { status: 404 });
  if (g.verifiedAt) return NextResponse.json({ error: "Esta garantía ya fue revisada." }, { status: 400 });

  const action = parsed.data.action;
  if (action === "handle" || action === "unhandle") {
    if (!role.canHandle) return NextResponse.json({ error: "Solo Joao marca esta garantía." }, { status: 403 });
    if (action === "handle") {
      if (g.handledAt) return NextResponse.json({ ok: true });
      await prisma.warrantyDispatchGuide.update({ where: { id }, data: { handledAt: new Date(), handledById: role.userId } });
      await resolveNewGuideNotice(g.guideNumber);
      await notifyVerifiers(g.guideNumber, await userName(role.userId));
    } else {
      if (g.handledById !== role.userId) return NextResponse.json({ error: "No la marcaste tú." }, { status: 403 });
      await prisma.warrantyDispatchGuide.update({ where: { id }, data: { handledAt: null, handledById: null } });
      await resolveVerifierNotice(g.guideNumber);
    }
    return NextResponse.json({ ok: true });
  }

  if (!role.canVerify) return NextResponse.json({ error: "Solo Daniel o Allan revisan." }, { status: 403 });
  if (!g.handledAt) return NextResponse.json({ error: "Joao todavía no la marca." }, { status: 400 });
  await prisma.warrantyDispatchGuide.update({ where: { id }, data: { verifiedAt: new Date(), verifiedById: role.userId } });
  await resolveVerifierNotice(g.guideNumber);
  return NextResponse.json({ ok: true });
}

// Quien la subió puede borrarla mientras Joao no la haya tomado.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = await getWarrantyDispatchRole();
  if (!role) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const g = await prisma.warrantyDispatchGuide.findUnique({ where: { id } });
  if (!g) return NextResponse.json({ error: "No existe." }, { status: 404 });
  if (g.uploadedById !== role.userId && !role.isAdmin) return NextResponse.json({ error: "Solo quien la subió puede quitarla." }, { status: 403 });
  if (g.handledAt) return NextResponse.json({ error: "Joao ya la está gestionando; ya no se puede quitar." }, { status: 400 });
  await prisma.warrantyDispatchGuide.delete({ where: { id } });
  await resolveNewGuideNotice(g.guideNumber);
  return NextResponse.json({ ok: true });
}
