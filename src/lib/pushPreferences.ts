import { prisma } from "@/lib/prisma";

// Confirmado 2026-07-28: por defecto TODO está activado — una fila en
// PushCategoryPreference solo existe para un tipo que la persona apagó a
// propósito. Ausencia de fila = activado.
export async function getDisabledTypes(ownerId: string): Promise<Set<string>> {
  const rows = await prisma.pushCategoryPreference.findMany({ where: { ownerId }, select: { type: true } });
  return new Set(rows.map((r) => r.type));
}

export async function setTypeEnabled(ownerId: string, type: string, enabled: boolean): Promise<void> {
  if (enabled) {
    await prisma.pushCategoryPreference.deleteMany({ where: { ownerId, type } });
  } else {
    await prisma.pushCategoryPreference.upsert({
      where: { ownerId_type: { ownerId, type } },
      create: { ownerId, type },
      update: {},
    });
  }
}
