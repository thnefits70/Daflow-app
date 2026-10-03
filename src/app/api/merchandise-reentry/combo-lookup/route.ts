import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseReentry } from "@/lib/guards";

// Pedido del usuario 2026-10-03: en el registro a mano del Reingreso, Joel
// escribe el ID de Dropi como antes — y muchos IDs son combos/paquetes
// (166387 Papel Adhesivo, 122992 Antenas = 2 × Antena HD TV) que no están en
// el catálogo como producto suelto. Solo se devuelve un combo que YA existe
// con productos reales del catálogo; nunca algo inventado ni un código que no
// es producto (envío prioritario, códigos ignorados).
export async function GET(req: Request) {
  if (!(await canCaptureMerchandiseReentry())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const code = new URL(req.url).searchParams.get("code")?.trim() ?? "";
  if (!/^\d{3,}$/.test(code)) return NextResponse.json(null);
  const combo = await prisma.dropiCombo.findUnique({
    where: { code },
    select: { code: true, label: true, components: { select: { quantity: true, catalogItem: { select: { id: true, name: true, photos: true, justCode: true, pendingRegistration: true } } } } },
  });
  if (!combo || combo.components.length === 0) return NextResponse.json(null);
  return NextResponse.json(combo);
}
