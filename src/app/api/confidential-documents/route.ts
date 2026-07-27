import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireAdminSession } from "@/lib/guards";

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

const createSchema = z.object({
  title: z.string().trim().min(1, "Falta el título."),
  category: z.string().trim().optional(),
  grantedUserIds: z.array(z.string()).default([]),
  storagePath: z.string().min(1, "No se recibió ningún archivo."),
  fileName: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const { title, category, grantedUserIds, storagePath, fileName } = parsed.data;

  const doc = await prisma.confidentialDocument.create({
    data: {
      title,
      category: category || null,
      storagePath,
      fileName,
      grants: grantedUserIds.length > 0 ? { create: grantedUserIds.map((userId) => ({ userId })) } : undefined,
    },
    include: docInclude,
  });
  return NextResponse.json(doc, { status: 201 });
}
