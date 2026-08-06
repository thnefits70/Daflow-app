import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { readPaymentProof } from "@/lib/purchaseAi";
import { pushOwnerId } from "@/lib/pushOwner";
import { sendPushToOwner } from "@/lib/webPush";

const schema = z.object({ proofUrl: z.string().url() });

// Confirmado 2026-08-06: cuando el proveedor manda el comprobante del
// reembolso, la IA lo lee una vez y cruza el monto contra cantidad×precio
// (ya fijo desde que se creó la resolución, no editable). Si coincide, se
// le pide a admin que confirme en su banco que sí llegó — si no coincide,
// se guarda igual pero no se avanza al siguiente paso todavía.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const isAdmin = session?.user.role === "admin";
  if (!session || (!isAdmin && !(await canSubmitPurchaseRequests()))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const resolution = await prisma.purchaseUrgentResolution.findUnique({
    where: { id },
    include: { report: { include: { request: { select: { deptId: true, catalogItem: { select: { name: true } } } } } } },
  });
  if (!resolution || resolution.type !== "REFUND") return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (resolution.status !== "PENDING") return NextResponse.json({ error: "Ya fue confirmado." }, { status: 409 });

  let readAmount: number | null = null;
  try {
    const read = await readPaymentProof({ proofImageUrl: parsed.data.proofUrl, actorId: pushOwnerId(session), deptId: resolution.report.request.deptId });
    readAmount = read.readAmount;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo leer el comprobante." }, { status: 500 });
  }

  const matches = readAmount !== null && Math.abs(readAmount - resolution.amount) < 0.01;
  const updated = await prisma.purchaseUrgentResolution.update({
    where: { id },
    data: { refundProofUrl: parsed.data.proofUrl, refundAiMatch: matches, refundAiNote: matches ? `Coincide — $${readAmount?.toFixed(2)}` : `No coincide — el comprobante dice $${readAmount?.toFixed(2) ?? "?"}, debía ser $${resolution.amount.toFixed(2)}` },
  });

  if (matches) {
    await sendPushToOwner("admin", {
      title: "🏦 Verifica en tu banco — reembolso de proveedor",
      body: `${resolution.report.request.catalogItem.name} — $${resolution.amount.toFixed(2)} · confirma si ya llegó el dinero`,
      url: "/admin",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
