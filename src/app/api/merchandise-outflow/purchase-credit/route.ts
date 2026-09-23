import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageOutflowPurchaseGestion } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { notifyInventoryLeadDeteriorPurchaseResolved } from "@/lib/merchandiseOutflow";
import {
  computeCreditProofWarnings,
  findPossibleDuplicateCredits,
  hashProofFile,
  loadCreditableClaims,
  normalizeSupplierCode,
  verifyCreditProofRead,
  type CreditProofRead,
} from "@/lib/supplierCreditProof";

const schema = z.object({
  supplierId: z.string().min(1),
  itemIds: z.array(z.string().min(1)).min(1, "Marca al menos un reclamo."),
  amount: z.number().positive("El monto tiene que ser mayor a 0."),
  proofUrl: z.string().url({ message: "Falta el comprobante — captura del chat o documento donde el proveedor acepta el crédito." }),
  proofName: z.string().trim().optional(),
  read: z.unknown().nullable(),
  signature: z.string().nullable(),
  // Renglones del comprobante que Jariel emparejó (o desemparejó) a mano
  // con un reclamo — itemId null = "no es ninguno de estos".
  lineLinks: z.array(z.object({ lineIndex: z.number().int().min(0), itemId: z.string().min(1).nullable() })).default([]),
  note: z.string().trim().optional(),
});

// Confirmado 2026-09-23, pedido explícito del usuario (Jariel con Zheng wu):
// UN crédito del proveedor que cubre uno o VARIOS reclamos de deterioro
// escalado del mismo proveedor, con un solo comprobante. Los avisos (no
// cuadra el total, falta un producto, otro proveedor, comprobante repetido)
// se vuelven a calcular acá — si hay alguno, Jariel tiene que explicar la
// diferencia (note) y se le avisa a admin. Nunca bloquea del todo: a veces
// el proveedor manda la captura cortada o escribe mal un monto.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canManageOutflowPurchaseGestion())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { supplierId, itemIds, amount, proofUrl, proofName, signature, lineLinks } = parsed.data;
  const note = parsed.data.note?.trim() || null;

  let read: CreditProofRead | null = null;
  if (parsed.data.read) {
    if (!signature || !verifyCreditProofRead(parsed.data.read as CreditProofRead, proofUrl, signature)) {
      return NextResponse.json({ error: "La lectura del comprobante no coincide. Vuelve a leerlo." }, { status: 400 });
    }
    read = parsed.data.read as CreditProofRead;
  }

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { name: true } });
  if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado." }, { status: 404 });

  const creditable = await loadCreditableClaims(supplierId);
  const byId = new Map(creditable.map((c) => [c.id, c]));
  const claims = [...new Set(itemIds)].map((id) => byId.get(id));
  if (claims.some((c) => !c)) return NextResponse.json({ error: "Algún reclamo ya no está pendiente o no es de este proveedor. Recarga la página." }, { status: 409 });
  const selected = claims.filter((c): c is NonNullable<typeof c> => !!c);

  // Lo que Jariel corrigió a mano manda sobre lo que emparejó la IA.
  if (read) {
    const lines = read.lines.map((l) => ({ ...l }));
    for (const link of lineLinks) {
      const line = lines[link.lineIndex];
      if (!line) continue;
      if (link.itemId && !byId.has(link.itemId)) continue;
      for (const other of lines) if (link.itemId && other.claimId === link.itemId) other.claimId = null;
      line.claimId = link.itemId;
    }
    read = { ...read, lines };
  }

  const proofHash = await hashProofFile(proofUrl);
  const duplicates = await findPossibleDuplicateCredits({
    supplierId,
    proofHash,
    amount,
    catalogItemIds: selected.map((c) => c.catalogItemId).filter((x): x is string => !!x),
  });
  const warnings = computeCreditProofWarnings({ read, supplierName: supplier.name, selectedClaims: selected, amount, duplicates });
  if (warnings.length > 0 && !note) {
    return NextResponse.json({ error: "Algo no cuadra — explica la diferencia antes de confirmar.", warnings }, { status: 400 });
  }

  const names = selected.map((c) => c.name);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const credit = await tx.supplierCredit.create({
      data: {
        supplierId,
        amount,
        reason: `Deterioro escalado — ${names.join(", ")}`,
        proofUrl,
        proofName: proofName || null,
        proofHash,
        proofAiCheck: read ? JSON.parse(JSON.stringify(read)) : undefined,
        proofMismatchNote: warnings.length > 0 ? `${warnings.join(" ")}\nExplicación: ${note}` : null,
        status: "AVAILABLE",
        // Un solo reclamo: mismo enlace de siempre; varios: solo el grupo.
        outflowItemId: selected.length === 1 ? selected[0].id : null,
        createdById: session.user.id,
      },
    });
    await tx.merchandiseOutflowItem.updateMany({
      where: { id: { in: selected.map((c) => c.id) }, purchaseResolution: null },
      data: {
        purchaseResolution: "CREDIT_ISSUED",
        purchaseResolutionNote: note,
        purchaseResolvedAt: now,
        purchaseResolvedById: session.user.id,
        groupedSupplierCreditId: credit.id,
      },
    });
    // Cada renglón con código que quedó emparejado a un reclamo marcado se
    // recuerda para este proveedor — Jariel lo vio en pantalla antes de
    // confirmar ("se recordará: ZW-881 = Exprimidor").
    const selectedIds = new Set(selected.map((c) => c.id));
    for (const line of read?.lines ?? []) {
      if (!line.code || !line.claimId || !selectedIds.has(line.claimId)) continue;
      const claim = byId.get(line.claimId);
      if (!claim?.catalogItemId) continue;
      const code = normalizeSupplierCode(line.code);
      await tx.supplierProductCode.upsert({
        where: { supplierId_code: { supplierId, code } },
        create: { supplierId, code, catalogItemId: claim.catalogItemId, createdById: session.user.id },
        update: { catalogItemId: claim.catalogItemId },
      });
    }
  });

  await notifyInventoryLeadDeteriorPurchaseResolved({
    declaredName: names.join(" + "),
    quantity: selected.reduce((s, c) => s + c.quantity, 0),
    resolution: "CREDIT_ISSUED",
    creditAmount: amount,
  });
  if (warnings.length > 0) {
    await notifyOwner("admin", {
      title: "⚠️ Crédito de proveedor con diferencias",
      body: `${supplier.name} — $${amount.toFixed(2)} por ${names.join(", ")}. ${warnings[0]} Explicación: ${note}`,
      url: "/area/workspace?tab=compras&ptab=creditos",
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true });
}
