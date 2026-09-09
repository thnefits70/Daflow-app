import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnPurchaseInvoices } from "@/lib/guards";
import { getAppliedCreditsForGroup, getReservedCreditsForGroup } from "@/lib/supplierCredits";
import { reviewInvoiceDocument } from "@/lib/purchaseAi";

const schema = z.object({
  invoiceStatus: z.enum(["PENDING", "COMPLETE", "PARTIAL", "NON_FISCAL", "NONE"]),
  invoiceAmount: z.number().positive().nullable().optional(),
  invoiceDocUrl: z.string().url().nullable().optional(),
});

// Una factura suele cubrir TODOS los productos de la misma compra — se
// registra a nivel de grupo, no producto por producto.
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseInvoices()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  if (parsed.data.invoiceStatus === "PARTIAL" && !parsed.data.invoiceAmount) {
    return NextResponse.json({ error: "Falta el valor por el que se facturó." }, { status: 400 });
  }

  const rows = await prisma.purchaseRequest.findMany({
    where: { groupId },
    include: {
      catalogItem: { select: { name: true, justCode: true } },
      supplier: { select: { name: true } },
    },
  });
  if (rows.length === 0) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  const isAdmin = session.user.role === "admin";
  await prisma.purchaseRequest.updateMany({
    where: { groupId },
    data: {
      invoiceStatus: parsed.data.invoiceStatus,
      invoiceAmount: parsed.data.invoiceStatus === "PARTIAL" ? parsed.data.invoiceAmount : null,
      invoiceDocUrl: parsed.data.invoiceDocUrl || null,
      invoicedById: isAdmin ? null : session.user.id,
      // Confirmado 2026-08-13: momento en que Finanzas cierra la operación —
      // alimenta el tiempo total que se ve en Auditoría.
      invoicedAt: parsed.data.invoiceStatus === "PENDING" ? null : new Date(),
      // Se limpia si se vuelve a PENDING (edición) o si esta vez no hay
      // documento que leer — nunca deja un resumen viejo de una factura
      // distinta a la que quedó guardada.
      aiInvoiceReviewSummary: null,
      aiInvoiceReviewOk: null,
      aiInvoiceReviewAt: null,
    },
  });

  // Confirmado 2026-09-09: pedido explícito de Nairoby — la IA cruza el
  // documento recién subido contra productos/cantidades/precios declarados y
  // el crédito ya aplicado a esta compra, para que ni ella ni el admin
  // tengan que comparar cada dato a mano. Solo corre si de verdad hay
  // documento (sin documento no hay nada que leer) y la factura sí se está
  // registrando (no aplica a NONE, ni al volver a PENDING). Nunca bloquea:
  // si la IA falla, la factura queda registrada igual, solo sin resumen.
  if (parsed.data.invoiceDocUrl && (parsed.data.invoiceStatus === "COMPLETE" || parsed.data.invoiceStatus === "PARTIAL" || parsed.data.invoiceStatus === "NON_FISCAL")) {
    try {
      const r0 = rows[0];
      const [appliedCredits, reservedCredits] = await Promise.all([
        getAppliedCreditsForGroup(groupId),
        getReservedCreditsForGroup(groupId),
      ]);
      // Al momento de registrar la factura el crédito puede seguir RESERVED
      // (todavía no se paga de nuevo) o ya APPLIED (se pagó con crédito
      // antes) — se suman ambos, nunca coexisten créditos de ambos tipos
      // para la misma solicitud en la práctica, pero por si acaso.
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
        invoiceType: parsed.data.invoiceStatus,
        invoiceAmount: parsed.data.invoiceStatus === "PARTIAL" ? parsed.data.invoiceAmount ?? null : null,
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
