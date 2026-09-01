import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canSyncAtomData } from "@/lib/guards";
import { parseAtomPastedTable, previewAtomSync } from "@/lib/atomSync";

const schema = z.object({ rawText: z.string().min(1) });

export async function POST(req: NextRequest) {
  if (!(await canSyncAtomData())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Pega el texto copiado de ATOM." }, { status: 400 });

  const names = parseAtomPastedTable(parsed.data.rawText);
  if (names.length === 0) {
    return NextResponse.json({ error: "No se encontró ningún producto marcado 'Rentable' en el texto pegado." }, { status: 400 });
  }
  const preview = await previewAtomSync(names);
  return NextResponse.json({ preview });
}
