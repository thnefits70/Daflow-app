import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

const schema = z.object({ bankAccountId: z.string().min(1) });

// Confirmado 2026-08-06: quien solicitó la compra puede cambiar la cuenta
// bancaria del proveedor elegida en cualquier momento (no solo al pedir) —
// típicamente en respuesta a que el admin avisó que la cuenta actual no
// sirvió para pagar. Cambiar la cuenta limpia ese aviso y notifica a admin
// que ya puede intentar de nuevo.
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await auth();
  if (!session || !(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const existing = await prisma.purchaseRequest.findFirst({ where: { groupId }, select: { supplierId: true, status: true, bankAccountId: true, supplier: { select: { name: true } }, catalogItem: { select: { name: true } } } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  // Confirmado 2026-09-23, revisión anti-fraude pedida por el usuario:
  // (1) la cuenta tiene que ser de ESTE proveedor, (2) una vez pagada ya no
  // se cambia (alteraría el historial), (3) si se cambia DESPUÉS de aprobar,
  // quien aprobó nunca vio la cuenta nueva — queda marcado y al pagar sale
  // en rojo para confirmarlo a propósito.
  const account = await prisma.supplierBankAccount.findUnique({ where: { id: parsed.data.bankAccountId }, select: { supplierId: true, bankAccountHolder: true, bankName: true, bankAccountNumber: true } });
  if (!account || account.supplierId !== existing.supplierId) {
    return NextResponse.json({ error: "Esa cuenta no es de este proveedor." }, { status: 400 });
  }
  if (existing.status !== "PENDING_APPROVAL" && existing.status !== "APPROVED") {
    return NextResponse.json({ error: "Esta solicitud ya se pagó o se cerró — la cuenta ya no se puede cambiar." }, { status: 409 });
  }
  if (existing.bankAccountId === parsed.data.bankAccountId) {
    return NextResponse.json(await prisma.purchaseRequest.findMany({ where: { groupId } }));
  }
  const afterApproval = existing.status === "APPROVED";

  await prisma.purchaseRequest.updateMany({
    where: { groupId },
    data: {
      bankAccountId: parsed.data.bankAccountId,
      bankAccountChangeRequestedAt: null,
      bankAccountChangeNote: null,
      bankAccountChangeRequestedById: null,
      ...(afterApproval
        ? { bankAccountChangedAfterApprovalAt: new Date(), bankAccountChangedAfterApprovalById: session.user.role === "admin" ? null : session.user.id }
        : {}),
    },
  });
  await notifyOwner("admin", {
    title: afterApproval ? "⚠️ Cuenta cambiada después de aprobar" : "🏦 Cuenta bancaria actualizada",
    body: afterApproval
      ? `${existing.supplier.name} — ${existing.catalogItem.name}: ahora se pagaría a ${account.bankAccountHolder} (${account.bankName} …${account.bankAccountNumber.slice(-4)}). Quien aprobó no vio esta cuenta — confírmala antes de pagar.`
      : `${existing.catalogItem.name} — ya puedes intentar pagar de nuevo`,
    url: "/admin",
  });

  const updated = await prisma.purchaseRequest.findMany({ where: { groupId } });
  return NextResponse.json(updated);
}
