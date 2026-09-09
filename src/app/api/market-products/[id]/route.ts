import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canProposeMarketProduct, canReviewMarketProduct } from "@/lib/guards";
import { computeProposalTraceability, cheapestSupplierPrice } from "@/lib/marketProduct";

// Confirmado 2026-09-09 (Fase 2, Análisis de Mercado): detalle completo de
// una propuesta, incluida la trazabilidad y el historial de cambios de
// precio — pantalla de Bryan (paso 5) y de Jariel (para ver/editar su
// propia propuesta).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (!(await canProposeMarketProduct()) && !(await canReviewMarketProduct())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const proposal = await prisma.marketProductProposal.findUnique({
    where: { id },
    include: {
      proposedBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
      publishedBy: { select: { name: true } },
      brandedBy: { select: { name: true } },
      readyToBuyBy: { select: { name: true } },
      chosenSupplier: { select: { id: true, name: true, paymentMode: true } },
      catalogItem: { select: { id: true, name: true, photos: true } },
      supplierPrices: { include: { supplier: { select: { id: true, name: true, paymentMode: true } } } },
      priceChanges: { include: { changedBy: { select: { name: true } } }, orderBy: { changedAt: "desc" } },
    },
  });
  if (!proposal) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  const traceability = computeProposalTraceability(proposal);
  const suggestedSupplierId = cheapestSupplierPrice(proposal.supplierPrices)?.supplierId ?? null;

  return NextResponse.json({ ...proposal, traceability, suggestedSupplierId });
}
