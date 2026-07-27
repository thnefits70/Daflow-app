import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";
import { supabaseAdmin } from "@/lib/supabase";
import { CONFIDENTIAL_BUCKET } from "@/lib/confidentialDocs";

const docInclude = {
  grants: { include: { user: { select: { id: true, name: true } } } },
};

const updateSchema = z.object({
  title: z.string().trim().min(1).optional(),
  category: z.string().trim().optional(),
  grantedUserIds: z.array(z.string()).optional(),
  storagePath: z.string().min(1).optional(),
  fileName: z.string().min(1).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;

  const existing = await prisma.confidentialDocument.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const { title, category, grantedUserIds, storagePath, fileName } = parsed.data;

  const data: { title?: string; category?: string | null; storagePath?: string; fileName?: string } = {};
  if (title) data.title = title;
  if (category !== undefined) data.category = category || null;

  let oldPathToRemove: string | null = null;
  if (storagePath && fileName) {
    data.storagePath = storagePath;
    data.fileName = fileName;
    oldPathToRemove = existing.storagePath;
  }

  // Diff the grant list instead of replacing wholesale, so someone who
  // already saw the document doesn't get an unread badge again just because
  // an unrelated person was added to (or removed from) the share list.
  if (grantedUserIds !== undefined) {
    const current = await prisma.confidentialDocumentAccess.findMany({
      where: { documentId: id },
      select: { userId: true },
    });
    const currentIds = new Set(current.map((g) => g.userId));
    const nextIds = new Set(grantedUserIds);
    const toRemove = [...currentIds].filter((uid) => !nextIds.has(uid));
    const toAdd = [...nextIds].filter((uid) => !currentIds.has(uid));
    if (toRemove.length) {
      await prisma.confidentialDocumentAccess.deleteMany({ where: { documentId: id, userId: { in: toRemove } } });
    }
    if (toAdd.length) {
      await prisma.confidentialDocumentAccess.createMany({
        data: toAdd.map((userId) => ({ documentId: id, userId })),
      });
    }
  }

  const updated = await prisma.confidentialDocument.update({ where: { id }, data, include: docInclude });

  if (oldPathToRemove) {
    await supabaseAdmin().storage.from(CONFIDENTIAL_BUCKET).remove([oldPathToRemove]).catch(() => {});
  }

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;

  const doc = await prisma.confidentialDocument.findUnique({ where: { id } });
  if (doc) {
    await supabaseAdmin().storage.from(CONFIDENTIAL_BUCKET).remove([doc.storagePath]).catch(() => {});
  }
  await prisma.confidentialDocument.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
