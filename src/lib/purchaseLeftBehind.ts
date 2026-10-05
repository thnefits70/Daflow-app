import { prisma } from "@/lib/prisma";
import { notifyOwner, resolveNotifications } from "@/lib/notifications";
import { getPurchaseLinesLeftBehind } from "@/lib/purchases";

// Pedido de Jariel 2026-10-05: apenas Inventario registra parte de un pedido,
// si queda otro producto del mismo pedido sin registrar se le pregunta al
// instante a Inventario si llegó o no. Si confirma que no llegó
// ([id]/not-arrived), la alerta pasa en el momento a quien compró. Las 24 h
// de getPurchaseLinesLeftBehind quedan solo como respaldo si nadie responde.
export const LINES_TO_CONFIRM_TITLE = "📦 Falta registrar un producto del pedido";
export const INVENTORY_RECEIVING_HREF = "/area/workspace?tab=compras&ptab=inventario";

export async function getLinesToConfirm() {
  return getPurchaseLinesLeftBehind(undefined, 0);
}

async function getInventoryRecipientIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [{ department: { code: "INV" } }, { isLeader: true, leadsDept: { code: "INV" } }],
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

function bodyPrefix(supplierName: string) {
  return `Pedido de ${supplierName}:`;
}

// Sin cantidades: el equipo de Inventario no las ve (solo Daniel).
export async function notifyInventoryLinesToConfirm(groupId: string): Promise<void> {
  const lines = (await getLinesToConfirm()).filter((l) => l.groupId === groupId);
  if (lines.length === 0) {
    // Ya se registró lo último que faltaba: se apaga el aviso anterior.
    const any = await prisma.purchaseRequest.findFirst({ where: { groupId }, select: { supplier: { select: { name: true } } } });
    if (any) await resolveInventoryLinesToConfirm(groupId, any.supplier?.name ?? "proveedor");
    return;
  }
  const prefix = bodyPrefix(lines[0].supplierName);
  const names = lines.map((l) => l.name).join(", ");
  for (const ownerId of await getInventoryRecipientIds()) {
    // Reemplaza el aviso anterior del mismo pedido (se registra producto por
    // producto) para no apilar avisos.
    await resolveNotifications(ownerId, LINES_TO_CONFIRM_TITLE, prefix).catch(() => null);
    await notifyOwner(ownerId, {
      title: LINES_TO_CONFIRM_TITLE,
      body: `${prefix} ya se registró lo demás y falta ${names}. ¿Llegó o no llegó? Confírmalo en Inventario.`,
      url: INVENTORY_RECEIVING_HREF,
    }).catch(() => null);
  }
}

export async function resolveInventoryLinesToConfirm(groupId: string, supplierName: string): Promise<void> {
  const pending = (await getLinesToConfirm()).some((l) => l.groupId === groupId);
  if (pending) return;
  for (const ownerId of await getInventoryRecipientIds()) {
    await resolveNotifications(ownerId, LINES_TO_CONFIRM_TITLE, bodyPrefix(supplierName)).catch(() => null);
  }
}
