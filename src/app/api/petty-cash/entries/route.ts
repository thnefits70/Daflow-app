import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManagePettyCashPrincipal, canManagePettyCashSecundaria } from "@/lib/guards";
import {
  getOrCreateBox, hasPendingConfirmation, checkFreightAlreadyPaid, hasApprovedException,
  markGroupFreightPaid,
} from "@/lib/pettyCash";
import { hashFileFromUrl } from "@/lib/fileHash";
import { readPettyCashProof } from "@/lib/pettyCashAi";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  boxType: z.enum(["PRINCIPAL", "SECUNDARIA"]),
  amount: z.number().positive(),
  description: z.string().trim().min(1),
  proofUrl: z.string().url().nullable().optional(),
  linkedGroupId: z.string().nullable().optional(),
  manualReason: z.string().trim().nullable().optional(),
});

// Confirmado 2026-08-05: registrar un desembolso (solicitud de pago) — se
// bloquea si la caja tiene una recarga sin confirmar, si la orden de pago ya
// tiene flete pagado (sin excepción aprobada), o si el comprobante es una
// foto ya usada antes en cualquier otro movimiento (hash duplicado).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const d = parsed.data;

  const authorized = d.boxType === "PRINCIPAL" ? await canManagePettyCashPrincipal() : await canManagePettyCashSecundaria();
  if (!authorized) return NextResponse.json({ error: "No autorizado para esta caja." }, { status: 403 });

  const box = await getOrCreateBox(d.boxType);

  if (await hasPendingConfirmation(box.id)) {
    return NextResponse.json({ error: "Tienes una recarga pendiente de confirmar — confírmala antes de registrar un desembolso." }, { status: 409 });
  }

  if (d.linkedGroupId) {
    const check = await checkFreightAlreadyPaid(d.linkedGroupId);
    if (check.alreadyPaid) {
      const approved = await hasApprovedException(box.id, d.linkedGroupId);
      if (!approved) {
        return NextResponse.json(
          { error: `Esta orden de pago ya tiene el flete pagado el ${check.paidAt} por ${check.paidByName}. Si de verdad hace falta un segundo pago, solicita una excepción.`, needsException: true },
          { status: 409 }
        );
      }
    }
  }

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
      // La IA no pudo leer el comprobante — se guarda igual, solo sin verificación.
    }
  }

  // Confirmado 2026-08-06: un mismatch CONFIRMADO (no solo "no se pudo leer")
  // bloquea el guardado — la persona debe cambiar la foto o corregir el
  // monto. La verificación en vivo (verify-proof) ya debería haber avisado
  // esto antes de llegar aquí; este chequeo es la defensa server-side.
  if (aiMatches === false) {
    return NextResponse.json(
      { error: `Rechazado — el comprobante muestra $${aiReadAmount?.toFixed(2)}, pero ingresaste $${d.amount.toFixed(2)}.` },
      { status: 409 }
    );
  }

  const isAdmin = session.user.role === "admin";
  const entry = await prisma.pettyCashEntry.create({
    data: {
      boxId: box.id,
      kind: "DESEMBOLSO",
      amount: d.amount,
      description: d.description,
      proofUrl: d.proofUrl || null,
      proofHash,
      aiReadAmount,
      aiMatches,
      linkedGroupId: d.linkedGroupId || null,
      manualReason: d.linkedGroupId ? null : d.manualReason || null,
      createdById: isAdmin ? null : session.user.id,
      updatedById: isAdmin ? null : session.user.id,
    },
  });

  if (d.linkedGroupId) {
    await markGroupFreightPaid(d.linkedGroupId, isAdmin ? null : session.user.id, d.proofUrl || null);
  }

  return NextResponse.json({ ok: true, entry });
}
