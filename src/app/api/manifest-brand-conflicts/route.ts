import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canSetMissingComboBrand } from "@/lib/comboAlias";
import { getOpenManifestBrandConflicts, resolveManifestBrandConflict } from "@/lib/manifestBrandConflicts";

// Pedido del usuario 2026-10-14 — ver lib/manifestBrandConflicts.ts. La
// asesora B2B ve los casos de su primera decisión; el admin ve todos.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ items: [] });
  const isAdmin = session.user.role === "admin";
  if (!isAdmin && !(await canSetMissingComboBrand())) return NextResponse.json({ items: [] });
  return NextResponse.json({ items: await getOpenManifestBrandConflicts(isAdmin) });
}

const schema = z.object({ id: z.string().min(1), action: z.enum(["KEEP", "CHANGE"]) });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const isAdmin = session.user.role === "admin";
  if (!isAdmin && !(await canSetMissingComboBrand())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const r = await resolveManifestBrandConflict(parsed.data.id, parsed.data.action, {
    isAdmin,
    userId: isAdmin ? null : session.user.id,
    name: isAdmin ? "Administrador" : (session.user.name ?? "Asesora B2B"),
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
