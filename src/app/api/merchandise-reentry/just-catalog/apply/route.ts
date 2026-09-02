import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManageJustCatalog } from "@/lib/guards";
import { applyJustCatalogImport } from "@/lib/justCatalog";
import { suggestNichoIfMissing } from "@/lib/nichoAi";

const schema = z.object({
  totalRows: z.number().int().nonnegative(),
  newRows: z.array(z.object({ code: z.string().min(1), name: z.string().min(1) })),
  nameChangedDecisions: z.array(z.object({ itemId: z.string(), code: z.string().min(1), justName: z.string().min(1), useJustName: z.boolean() })),
  suggestedLinkDecisions: z.array(z.object({ itemId: z.string(), code: z.string().min(1), name: z.string().min(1), link: z.boolean() })),
  duplicateGroupDecisions: z.array(z.object({ code: z.string().min(1), name: z.string().min(1) })),
  duplicateGroupResolutions: z.array(z.object({ groupName: z.string().min(1), codes: z.array(z.string().min(1)), decision: z.string().min(1) })),
  duplicateGroupsTotal: z.number().int().nonnegative(),
  duplicateGroupsResolved: z.number().int().nonnegative(),
  missingCount: z.number().int().nonnegative(),
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

  // Confirmado 2026-09-01: pedido explícito del usuario — sugerencia de
  // nicho automática, sin depender de ningún clic. Corre después de
  // responder (no retrasa la subida) y en paralelo, best-effort.
  if (result.newlyCreatedIds.length > 0) {
    after(async () => {
      await Promise.allSettled(result.newlyCreatedIds.map((id) => suggestNichoIfMissing(id)));
    });
  }

  return NextResponse.json({ ok: true, ...result });
}
