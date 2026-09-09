import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnPurchaseInvoices } from "@/lib/guards";
import { getAppliedCreditsForGroup, getReservedCreditsForGroup } from "@/lib/supplierCredits";
import { reviewInvoiceDocument } from "@/lib/purchaseAi";

const schema = z.object({
  invoiceDocUrl: z.string().url(),
});

// Reemplaza SOLO el documento de una factura ya registrada (invoiceStatus,
// invoiceAmount, invoicedBy e invoicedAt no cambian) — para corregir un
// archivo mal subido sin tocar el resto del registro ni el tiempo de cierre
// que alimenta Auditoría.
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseInvoices()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const rows = await prisma.purchaseRequest.findMany({
    where: { groupId },
    include: {
      catalogItem: { select: { name: true, justCode: true } },
      supplier: { select: { name: true } },
    },
  });
  if (rows.length === 0) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  const r0 = rows[0];
  if (r0.invoiceStatus === "PENDING") return NextResponse.json({ error: "Esta operación todavía no tiene factura registrada." }, { status: 400 });

  await prisma.purchaseRequest.updateMany({
    where: { groupId },
    data: { invoiceDocUrl: parsed.data.invoiceDocUrl, aiInvoiceReviewSummary: null, aiInvoiceReviewOk: null, aiInvoiceReviewAt: null },
  });

  // Confirmado 2026-09-09: el documento nuevo reemplaza al que ya se había
  // revisado — se vuelve a cruzar contra los mismos datos declarados, mismo
  // patrón (y misma razón para no bloquear si falla) que en invoice/route.ts.
  if (r0.invoiceStatus === "COMPLETE" || r0.invoiceStatus === "PARTIAL" || r0.invoiceStatus === "NON_FISCAL") {
    try {
      const [appliedCredits, reservedCredits] = await Promise.all([
        getAppliedCreditsForGroup(groupId),
        getReservedCreditsForGroup(groupId),
      ]);
      const credits = [...appliedCredits, ...reservedCredits];
      const linesTotal = rows.reduce((s, r) => s + r.totalCost, 0);
      const review = await reviewInvoiceDocument({
        actorId: session.user.id,
        deptId: session.user.deptId ?? undefined,
        invoiceDocUrl: parsed.data.invoiceDocUrl,
        supplierName: r0.supplier.name,
        requestNumber: r0.requestNumber,
        lines: rows.map((r) => ({
          name: r.catalogItem.name,
          justCode: r.catalogItem.justCode,
          quantity: r.quantity,
          unitCost: r.unitCost,
          totalCost: r.totalCost,
        })),
        linesTotal,
        invoiceType: r0.invoiceStatus,
        invoiceAmount: r0.invoiceStatus === "PARTIAL" ? r0.invoiceAmount : null,
        appliedCreditTotal: credits.reduce((s, c) => s + c.amount, 0),
        appliedCreditReasons: credits.map((c) => c.reason),
      });
      await prisma.purchaseRequest.updateMany({
        where: { groupId },
        data: { aiInvoiceReviewSummary: review.summary, aiInvoiceReviewOk: review.ok, aiInvoiceReviewAt: new Date() },
      });
    } catch {
      // Sin bloquear — ver comentario arriba.
    }
  }

  const updated = await prisma.purchaseRequest.findMany({ where: { groupId } });
  return NextResponse.json(updated);
}
