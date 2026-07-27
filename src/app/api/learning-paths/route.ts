import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/guards";
import { createLearningPath, listLearningPaths } from "@/lib/learningPaths";

export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const paths = await listLearningPaths();
  return NextResponse.json(paths);
}

const createSchema = z.object({
  title: z.string().trim().min(1, "El título es obligatorio."),
  description: z.string().trim().default(""),
});

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const created = await createLearningPath(parsed.data.title, parsed.data.description);
  return NextResponse.json(created, { status: 201 });
}
