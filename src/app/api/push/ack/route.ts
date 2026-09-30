import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ACK_LATE_MS } from "@/lib/webPush";

// 2026-09-30: el celular (public/sw.js) avisa aquí cada vez que muestra una
// notificación. Sin sesión a propósito: el service worker corre aunque
// DAFLOW esté cerrado, y lo único que se puede hacer con un sid es poner su
// contador en cero. Si el aviso salió tarde (Chrome estaba cerrado por el
// ahorro de batería), no cuenta como mostrado a tiempo.
const schema = z.object({ sid: z.string().min(1).max(64), st: z.number().optional() });

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  const onTime = !parsed.data.st || Date.now() - parsed.data.st <= ACK_LATE_MS;
  await prisma.pushSubscription
    .updateMany({
      where: { id: parsed.data.sid },
      data: onTime ? { lastAckAt: new Date(), missedCount: 0 } : { lastAckAt: new Date() },
    })
    .catch(() => null);
  return NextResponse.json({ ok: true });
}
