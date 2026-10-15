import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dbUserId } from "@/lib/guards";
import { privatePathOf } from "@/lib/privateFiles";
import {
  decideOutOfHours,
  getMichelleCancelRole,
  markNotRetained,
  markRetained,
} from "@/lib/michelleCancellations";

// accept / reject: Daniel decide las pedidas fuera de horario.
// retained: Joao (o Daniel/Allan) la retuvo, con foto en vivo.
// not_retained: ya había salido o no se encontró.
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({ action: z.literal("reject") }),
  z.object({ action: z.literal("retained"), photoUrl: z.string().url() }),
  z.object({
    action: z.literal("not_retained"),
    reason: z.enum(["ya_salio", "no_encontrada"]),
  }),
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const role = await getMichelleCancelRole();
  if (!role?.canRetain)
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Datos no válidos." }, { status: 400 });
  const { id } = await params;
  const me = dbUserId(role.userId);
  const b = parsed.data;
  let error: string | null = null;
  if (b.action === "accept" || b.action === "reject") {
    if (!role.canDecide)
      return NextResponse.json(
        { error: "Solo Daniel decide las cancelaciones fuera de horario." },
        { status: 403 },
      );
    error = await decideOutOfHours(id, b.action === "accept", me);
  } else if (b.action === "retained") {
    // Solo fotos subidas a la carpeta de esta función (no cualquier enlace).
    if (!privatePathOf(b.photoUrl)?.startsWith("cancelled-guide-photos/"))
      return NextResponse.json(
        { error: "Falta la foto de evidencia." },
        { status: 400 },
      );
    error = await markRetained(id, b.photoUrl, me);
  } else error = await markNotRetained(id, b.reason, me);
  if (error) return NextResponse.json({ error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
