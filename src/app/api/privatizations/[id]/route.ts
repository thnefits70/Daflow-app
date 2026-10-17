import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { endPrivatization, getPrivatizationRole, markPrivatized, reviewPrivatization } from "@/lib/privatizations";

const schema = z.object({
  action: z.enum(["approve", "reject", "privatized", "end"]),
  note: z.string().trim().max(1000).nullable().optional(),
});

// approve/reject: Bryan · privatized: el asesor ya lo hizo en Dropi · end:
// el asesor desprivatiza (o retira una que todavía no se privatizó).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = await getPrivatizationRole();
  if (!role || role.isAdmin) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const { action, note } = parsed.data;
  const r =
    action === "approve" || action === "reject"
      ? await reviewPrivatization(id, action === "approve", note ?? null, role)
      : action === "privatized"
        ? await markPrivatized(id, role)
        : await endPrivatization(id, note ?? null, role);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
