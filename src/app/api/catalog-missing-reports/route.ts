import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canManageJustCatalog, dbUserId } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { actorName } from "@/lib/actorName";

const schema = z.object({
  query: z.string().trim().min(1),
  note: z.string().trim().optional(),
});

// Confirmado 2026-08-29: reemplaza "escribir el nombre a mano" en
// ProductMatchPicker — cualquiera que esté logueado puede avisar que un
// producto real todavía no está en el catálogo (la sincronización con Just
// es manual, así que siempre puede haber un hueco). Notifica a quien
// administra el catálogo (Daniel/admin, canManageJustCatalog) en vez de
// dejar que la persona invente un nombre libre.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const report = await prisma.catalogMissingReport.create({
    data: { query: parsed.data.query, note: parsed.data.note || null, reportedById: dbUserId(session.user.id) },
  });

  const invLeader = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "INV" } }, select: { id: true } });
  const body_ = `${actorName(session.user.name)} no encontró "${parsed.data.query}" en el catálogo.`;
  if (invLeader) await notifyOwner(invLeader.id, { title: "📦 Falta un producto en el catálogo", body: body_, url: "/area/reingreso-mercaderia?tab=productos" });
  await notifyOwner("admin", { title: "📦 Falta un producto en el catálogo", body: body_, url: "/admin/reingreso-mercaderia?tab=productos" });

  return NextResponse.json(report);
}

// Solo quien administra el catálogo ve la cola de reportes pendientes.
export async function GET() {
  if (!(await canManageJustCatalog())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const reports = await prisma.catalogMissingReport.findMany({
    where: { resolvedAt: null },
    orderBy: { reportedAt: "asc" },
    include: { reportedBy: { select: { name: true } } },
  });
  return NextResponse.json(reports);
}
