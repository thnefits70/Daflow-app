import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManagePettyCashPrincipal } from "@/lib/guards";
import { getOrCreateBox } from "@/lib/pettyCash";
import { hashFileFromUrl } from "@/lib/fileHash";
import { readPettyCashProof } from "@/lib/pettyCashAi";
import { prisma } from "@/lib/prisma";
import { sendPushToOwner } from "@/lib/webPush";

const schema = z.object({
  boxType: z.enum(["PRINCIPAL", "SECUNDARIA"]),
  amount: z.number().positive(),
  description: z.string().trim().min(1),
  proofUrl: z.string().url().nullable().optional(),
});

// Confirmado 2026-08-05: fondear una caja — Principal solo la fondea el
// dueño; Secundaria la puede fondear el dueño O Nairoby (entrega directa a
// Bryan). Nunca se acredita al saldo aquí — queda pendiente hasta que quien
// la recibe confirma con un clic (ver /recharge/[id]/confirm).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const d = parsed.data;

  const isAdmin = session.user.role === "admin";
  if (d.boxType === "PRINCIPAL" && !isAdmin) {
    return NextResponse.json({ error: "Solo el dueño puede fondear la Caja Chica Principal." }, { status: 403 });
  }
  if (d.boxType === "SECUNDARIA" && !isAdmin && !(await canManagePettyCashPrincipal())) {
    return NextResponse.json({ error: "No autorizado para fondear esta caja." }, { status: 403 });
  }

  const box = await getOrCreateBox(d.boxType);

  let proofHash: string | null = null;
  if (d.proofUrl) {
    proofHash = await hashFileFromUrl(d.proofUrl);
    const duplicate = await prisma.pettyCashEntry.findFirst({ where: { proofHash } });
    if (duplicate) {
      return NextResponse.json({ error: "Este comprobante ya se usó antes en otro movimiento — sube una foto distinta." }, { status: 409 });
    }
  }

  let aiReadAmount: number | null = null;
  let aiMatches: boolean | null = null;
  if (d.proofUrl) {
    try {
      const read = await readPettyCashProof({ proofUrl: d.proofUrl, actorId: session.user.id, deptId: session.user.deptId ?? undefined });
      aiReadAmount = read.readAmount;
      aiMatches = read.readAmount !== null && Math.abs(read.readAmount - d.amount) < 0.01;
    } catch {
      // Sigue igual sin verificación si la IA no pudo leerlo.
    }
  }

  const entry = await prisma.pettyCashEntry.create({
    data: {
      boxId: box.id,
      kind: "RECARGA",
      amount: d.amount,
      description: d.description,
      proofUrl: d.proofUrl || null,
      proofHash,
      aiReadAmount,
      aiMatches,
      createdById: isAdmin ? null : session.user.id,
      updatedById: isAdmin ? null : session.user.id,
    },
  });

  // Confirmado 2026-08-05: quien recibe (líder de la caja) debe confirmar —
  // se le avisa directo, aparte del bloqueo visual que ya ve al entrar.
  const recipient = await prisma.user.findFirst({
    where: d.boxType === "PRINCIPAL" ? { isLeader: true, leadsDept: { code: "FIN" } } : { canManagePettyCashSecundaria: true },
    select: { id: true },
  });
  if (recipient) {
    await sendPushToOwner(recipient.id, {
      title: "💰 Te fondearon la Caja Chica",
      body: `$${d.amount.toFixed(2)} — confirma que lo recibiste`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true, entry });
}
