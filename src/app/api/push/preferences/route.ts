import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { pushOwnerId } from "@/lib/pushOwner";
import { PENDING_TYPE_CATALOG, getPossiblePendingTypesForActor, type PendingTasksActor } from "@/lib/pendingTasks";
import { getDisabledTypes, setTypeEnabled } from "@/lib/pushPreferences";

async function actorFromSession(session: { user: { role: string; id: string } }): Promise<PendingTasksActor> {
  return session.user.role === "admin" ? { isAdmin: true } : { isAdmin: false, userId: session.user.id };
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ items: [] });

  const actor = await actorFromSession(session);
  const possible = await getPossiblePendingTypesForActor(actor);
  if (possible.length === 0) return NextResponse.json({ items: [] });

  const disabled = await getDisabledTypes(pushOwnerId(session));
  const items = possible.map((p) => ({ ...p, enabled: !disabled.has(p.type) }));
  return NextResponse.json({ items });
}

const prefSchema = z.object({
  type: z.enum(Object.keys(PENDING_TYPE_CATALOG) as [string, ...string[]]),
  enabled: z.boolean(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = prefSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  await setTypeEnabled(pushOwnerId(session), parsed.data.type, parsed.data.enabled);
  return NextResponse.json({ ok: true });
}
