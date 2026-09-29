import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests, canActOnPurchaseApproval } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { getPriceCorrectableRequests, getPriceCorrections, submitPriceCorrection } from "@/lib/purchasePriceCorrection";

// Confirmado 2026-09-29: piden quien compra (Jariel) o quien aprueba compras
// (Bryan); solo el admin aprueba (ver review/route.ts).
async function canRequestPriceCorrection() {
  return (await canSubmitPurchaseRequests()) || (await canActOnPurchaseApproval());
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const isAdmin = session.user.role === "admin";
  const canRequest = isAdmin || (await canRequestPriceCorrection());
  if (!canRequest) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const [corrections, eligible] = await Promise.all([getPriceCorrections(), getPriceCorrectableRequests()]);
  return NextResponse.json({ corrections, eligible, isAdmin });
}

const schema = z.object({
  requestId: z.string().min(1),
  newUnitCost: z.number().positive("El precio nuevo debe ser mayor a 0."),
  reason: z.string().trim().min(1, "Explica qué se negoció con el proveedor."),
  proofUrl: z.string().url("Sube la captura del acuerdo con el proveedor."),
  proofName: z.string().trim().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const isAdmin = session.user.role === "admin";
  if (!isAdmin && !(await canRequestPriceCorrection())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  try {
    const { correction, request } = await submitPriceCorrection({
      requestId: parsed.data.requestId,
      newUnitCost: parsed.data.newUnitCost,
      reason: parsed.data.reason,
      proofUrl: parsed.data.proofUrl,
      proofName: parsed.data.proofName || null,
      requestedById: isAdmin ? null : session.user.id,
    });
    if (!isAdmin) {
      await notifyOwner("admin", {
        title: "💲 Corrección de precio por aprobar",
        body: `${request.catalogItem.name} (${request.supplier.name}): $${correction.oldUnitCost.toFixed(2)} → $${correction.newUnitCost.toFixed(2)} · ${request.quantity} un. — pedida por ${session.user.name ?? "Compras"}`,
        url: "/admin",
      }).catch(() => null);
    }
    return NextResponse.json(correction, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo registrar." }, { status: 409 });
  }
}
