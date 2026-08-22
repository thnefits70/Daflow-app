import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManageJustCatalog } from "@/lib/guards";
import { applyJustCatalogImport } from "@/lib/justCatalog";

const schema = z.object({
  totalRows: z.number().int().nonnegative(),
  newRows: z.array(z.object({ code: z.string().min(1), name: z.string().min(1) })),
  nameChangedDecisions: z.array(z.object({ itemId: z.string(), code: z.string().min(1), justName: z.string().min(1), useJustName: z.boolean() })),
  suggestedLinkDecisions: z.array(z.object({ itemId: z.string(), code: z.string().min(1), name: z.string().min(1), link: z.boolean() })),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canManageJustCatalog()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const result = await applyJustCatalogImport(parsed.data, parsed.data.totalRows, session.user.id);
  return NextResponse.json({ ok: true, ...result });
}
