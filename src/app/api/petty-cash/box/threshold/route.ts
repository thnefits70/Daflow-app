import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getOrCreateBox } from "@/lib/pettyCash";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  boxType: z.enum(["PRINCIPAL", "SECUNDARIA"]),
  minThreshold: z.number().nonnegative(),
});

// Confirmado 2026-08-29: a diferencia de desembolsos/recargas, el umbral de
// "saldo bajo" lo fija SOLO admin — quien administra la caja día a día
// (Bryan en Secundaria, Nairoby en Principal) ni lo ve ni lo puede tocar.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Solo admin puede fijar este mínimo." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { boxType, minThreshold } = parsed.data;

  const box = await getOrCreateBox(boxType);
  await prisma.pettyCashBox.update({ where: { id: box.id }, data: { minThreshold } });

  return NextResponse.json({ ok: true });
}
