import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireAdminSession } from "@/lib/guards";
import { supabaseAdmin } from "@/lib/supabase";
import { CONFIDENTIAL_BUCKET, CONFIDENTIAL_MAX_BYTES, ensureConfidentialBucket } from "@/lib/confidentialDocs";

const docInclude = {
  grants: { include: { user: { select: { id: true, name: true } } } },
};

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  if (session.user.role === "admin") {
    const docs = await prisma.confidentialDocument.findMany({
      orderBy: { createdAt: "desc" },
      include: docInclude,
    });
    return NextResponse.json({ mode: "manage", docs });
  }

  const grants = await prisma.confidentialDocumentAccess.findMany({
    where: { userId: session.user.id },
    orderBy: { grantedAt: "desc" },
    include: { document: true },
  });
  return NextResponse.json({
    mode: "own",
    docs: grants.map((g) => ({
      id: g.document.id,
      title: g.document.title,
      category: g.document.category,
      fileName: g.document.fileName,
      grantedAt: g.grantedAt,
      seenAt: g.seenAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const title = (formData.get("title") as string | null)?.trim();
  const category = (formData.get("category") as string | null)?.trim() || null;
  const grantedUserIdsRaw = formData.get("grantedUserIds") as string | null;
  const file = formData.get("file");

  if (!title) return NextResponse.json({ error: "Falta el título." }, { status: 400 });
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No se recibió ningún archivo." }, { status: 400 });
  }
  if (file.size > CONFIDENTIAL_MAX_BYTES) {
    return NextResponse.json({ error: "El archivo es muy pesado (máximo 15 MB)." }, { status: 400 });
  }

  let grantedUserIds: string[] = [];
  if (grantedUserIdsRaw) {
    try {
      grantedUserIds = JSON.parse(grantedUserIdsRaw);
    } catch {
      return NextResponse.json({ error: "Lista de personas inválida." }, { status: 400 });
    }
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

  const doc = await prisma.confidentialDocument.create({
    data: {
      title,
      category,
      storagePath: path,
      fileName: file.name,
      grants: grantedUserIds.length > 0 ? { create: grantedUserIds.map((userId) => ({ userId })) } : undefined,
    },
    include: docInclude,
  });
  return NextResponse.json(doc, { status: 201 });
}
