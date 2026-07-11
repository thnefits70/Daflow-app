import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireAdminSession, canWriteLaws } from "@/lib/guards";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const deptId = req.nextUrl.searchParams.get("deptId");
  const isLaw = req.nextUrl.searchParams.get("isLaw") === "true";

  if (isLaw) {
    const documents = await prisma.document.findMany({ where: { isLaw: true }, orderBy: { createdAt: "asc" } });
    return NextResponse.json(documents);
  }

  if (!deptId) return NextResponse.json({ error: "Falta deptId." }, { status: 400 });
  if (session.user.role === "employee" && session.user.deptId !== deptId) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const documents = await prisma.document.findMany({ where: { deptId }, orderBy: { createdAt: "asc" } });
  return NextResponse.json(documents);
}

const createSchema = z.object({
  title: z.string().trim().min(1, "El título es obligatorio."),
  deptId: z.string().nullable().optional(),
  isLaw: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const allowed = parsed.data.isLaw ? await canWriteLaws() : !!(await requireAdminSession());
  if (!allowed) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const document = await prisma.document.create({
    data: {
      title: parsed.data.title,
      deptId: parsed.data.isLaw ? null : parsed.data.deptId ?? null,
      isLaw: !!parsed.data.isLaw,
    },
  });
  return NextResponse.json(document, { status: 201 });
}
