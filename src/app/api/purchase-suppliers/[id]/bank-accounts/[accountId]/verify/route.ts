import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

// Confirmado 2026-09-23, revisión anti-fraude pedida por el usuario: solo el
// admin marca como verificada una cuenta bancaria que agregó otra persona
// (después de confirmar con el proveedor que es suya). Hasta entonces no se
// le puede transferir (ver group/[groupId]/pay y shipping-pay).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; accountId: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const session = await auth();
  const { id, accountId } = await params;
  const account = await prisma.supplierBankAccount.findUnique({ where: { id: accountId } });
  if (!account || account.supplierId !== id) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (account.verifiedAt) return NextResponse.json(account);
  const updated = await prisma.supplierBankAccount.update({
    where: { id: accountId },
    data: { verifiedAt: new Date(), verifiedById: session?.user.role === "admin" ? null : session?.user.id ?? null },
  });
  return NextResponse.json(updated);
}
