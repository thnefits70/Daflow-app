import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageOutflowPurchaseGestion } from "@/lib/guards";
import { findPossibleDuplicateCredits, hashProofFile, loadCreditableClaims, readSupplierCreditProof, signCreditProofRead } from "@/lib/supplierCreditProof";

const schema = z.object({ supplierId: z.string().min(1), proofUrl: z.string().url() });

// Confirmado 2026-09-23, pedido explícito del usuario: UNA lectura de IA por
// comprobante de crédito (ver supplierCreditProof.ts). Devuelve lo leído
// (firmado, para que al confirmar no se pueda cambiar en el camino) + los
// avisos de comprobante repetido + los reclamos que se pueden marcar. No
// guarda nada.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canManageOutflowPurchaseGestion())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Falta el comprobante." }, { status: 400 });
  const { supplierId, proofUrl } = parsed.data;

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { name: true } });
  if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado." }, { status: 404 });

  const [claims, codes, proofHash] = await Promise.all([
    loadCreditableClaims(supplierId),
    prisma.supplierProductCode.findMany({ where: { supplierId }, include: { catalogItem: { select: { name: true } } } }),
    hashProofFile(proofUrl),
  ]);
  if (claims.length === 0) return NextResponse.json({ error: "No hay reclamos de este proveedor listos para cerrar con crédito." }, { status: 400 });

  let read;
  try {
    read = await readSupplierCreditProof({
      proofUrl,
      supplierName: supplier.name,
      claims,
      knownCodes: codes.map((c) => ({ code: c.code, catalogItemId: c.catalogItemId, productName: c.catalogItem.name })),
      actorId: session.user.id,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "La IA no pudo leer el comprobante." }, { status: 502 });
  }

  const matchedCatalogIds = claims.filter((c) => c.catalogItemId && read.lines.some((l) => l.claimId === c.id)).map((c) => c.catalogItemId!);
  const duplicates = await findPossibleDuplicateCredits({ supplierId, proofHash, amount: read.total, catalogItemIds: matchedCatalogIds });

  return NextResponse.json({ read, signature: signCreditProofRead(read, proofUrl), duplicates, claims });
}
