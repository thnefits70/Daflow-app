import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManagePettyCashPrincipal, canManagePettyCashSecundaria } from "@/lib/guards";
import { getOrCreateBox } from "@/lib/pettyCash";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  boxType: z.enum(["PRINCIPAL", "SECUNDARIA"]),
  minThreshold: z.number().nonnegative(),
});

// Umbral de "saldo bajo" por caja — lo puede fijar quien administra esa caja
// día a día (mismo guard que ya cubre desembolsos/recargas), admin incluido.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { boxType, minThreshold } = parsed.data;

  const authorized = boxType === "PRINCIPAL" ? await canManagePettyCashPrincipal() : await canManagePettyCashSecundaria();
  if (!authorized) return NextResponse.json({ error: "No autorizado para esta caja." }, { status: 403 });

  const box = await getOrCreateBox(boxType);
  await prisma.pettyCashBox.update({ where: { id: box.id }, data: { minThreshold } });

  return NextResponse.json({ ok: true });
}
