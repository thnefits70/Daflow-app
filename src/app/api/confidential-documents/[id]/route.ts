import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";
import { supabaseAdmin } from "@/lib/supabase";
import { CONFIDENTIAL_BUCKET, CONFIDENTIAL_MAX_BYTES, ensureConfidentialBucket } from "@/lib/confidentialDocs";

const docInclude = {
  grants: { include: { user: { select: { id: true, name: true } } } },
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;

  const existing = await prisma.confidentialDocument.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const title = (formData.get("title") as string | null)?.trim();
  const categoryRaw = formData.get("category") as string | null;
  const grantedUserIdsRaw = formData.get("grantedUserIds") as string | null;
  const file = formData.get("file");

  const data: { title?: string; category?: string | null; storagePath?: string; fileName?: string } = {};
  if (title) data.title = title;
  if (categoryRaw !== null) data.category = categoryRaw.trim() || null;

  let oldPathToRemove: string | null = null;
  if (file && typeof file !== "string") {
    if (file.size > CONFIDENTIAL_MAX_BYTES) {
      return NextResponse.json({ error: "El archivo es muy pesado (máximo 15 MB)." }, { status: 400 });
    }
    const safeName = file.name.replace(/[^a-z0-9.\-_]/gi, "_");
    const path = `docs/${crypto.randomUUID()}-${safeName}`;
    await ensureConfidentialBucket();
    const supabase = supabaseAdmin();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error } = await supabase.storage.from(CONFIDENTIAL_BUCKET).upload(path, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (error) return NextResponse.json({ error: "No se pudo subir el archivo." }, { status: 500 });
    data.storagePath = path;
    data.fileName = file.name;
    oldPathToRemove = existing.storagePath;
  }

  // Diff the grant list instead of replacing wholesale, so someone who
  // already saw the document doesn't get an unread badge again just because
  // an unrelated person was added to (or removed from) the share list.
  if (grantedUserIdsRaw !== null) {
    let grantedUserIds: string[];
    try {
      grantedUserIds = JSON.parse(grantedUserIdsRaw);
    } catch {
      return NextResponse.json({ error: "Lista de personas inválida." }, { status: 400 });
    }
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
