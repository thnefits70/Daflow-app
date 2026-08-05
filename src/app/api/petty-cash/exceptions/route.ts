import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManagePettyCashSecundaria } from "@/lib/guards";
import { getOrCreateBox } from "@/lib/pettyCash";
import { prisma } from "@/lib/prisma";
import { sendPushToOwner } from "@/lib/webPush";

const schema = z.object({ groupId: z.string().min(1), reason: z.string().trim().min(1) });

// Confirmado 2026-08-05: Bryan pide autorización para un segundo pago de
// flete real sobre una orden de pago que ya tiene flete pagado — solo el
// dueño puede aprobar/rechazar (PATCH /exceptions/[id]).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canManagePettyCashSecundaria()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const box = await getOrCreateBox("SECUNDARIA");
  const isAdmin = session.user.role === "admin";
  const exception = await prisma.pettyCashFreightException.create({
    data: {
      boxId: box.id,
      groupId: parsed.data.groupId,
      reason: parsed.data.reason,
      requestedById: isAdmin ? null : session.user.id,
    },
  });

  await sendPushToOwner("admin", {
    title: "⚠️ Excepción de doble pago de flete",
    body: parsed.data.reason,
    url: "/admin",
  }).catch(() => null);

  return NextResponse.json({ ok: true, exception });
}
