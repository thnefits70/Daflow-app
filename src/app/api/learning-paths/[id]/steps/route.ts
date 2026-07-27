import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/guards";
import { addStepToPath } from "@/lib/learningPaths";

const createSchema = z.object({
  kind: z.enum(["document", "law", "process", "module"]),
  refId: z.string().min(1),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  try {
    const step = await addStepToPath(id, parsed.data.kind, parsed.data.refId);
    return NextResponse.json(step, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo agregar el contenido.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
