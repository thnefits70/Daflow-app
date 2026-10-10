import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { auth } from "@/auth";
import { notifyOwner } from "@/lib/notifications";
import { getB2BAdvisorTitle } from "@/lib/b2bAdvisorRole";
import { b2bAdvisorWithArticle } from "@/lib/b2bAdvisorRoleShared";

// Pedido del usuario 2026-10-10: un combo es la unión de productos físicos y
// tiene UNA sola marca madre en el Kardex de INVESTOCK. Daniel no puede
// saberla (los productos de un combo pueden ser de otra marca, o el combo
// estar solo en Rocket), así que la elige quien crea el combo. Si el mismo
// combo (misma receta exacta) se sube con otro ID, y quien lo registra
// confirma que es el mismo, ese ID apunta al primero que se registró en
// DAFLOW y toma su marca — nunca hay dos combos madre con la misma receta.

export const comboBrandSchema = z.enum(["MKT_DAMIAN", "MKT_PROVEDIX", "MKT_SHANGHAI", "MKT_SUMINISTROS"], {
  message: "Elige a qué marca pertenece este combo.",
});

type Recipe = { catalogItemId: string; quantity: number }[];

// Misma huella que comboFingerprint (lib/comboSuggestions.ts), sin cargar ese módulo.
function recipeFingerprint(parts: Recipe): string {
  const qty = new Map<string, number>();
  for (const p of parts) qty.set(p.catalogItemId, (qty.get(p.catalogItemId) ?? 0) + p.quantity);
  return [...qty.entries()].map(([id, q]) => `${id}x${q}`).sort().join("|");
}

// El combo madre con exactamente esta receta (el primero registrado), o null.
// Es una comparación exacta, nunca una adivinanza.
export async function findMotherComboByRecipe(recipe: Recipe, excludeCode?: string) {
  const fp = recipeFingerprint(recipe);
  const combos = await prisma.dropiCombo.findMany({
    where: { aliasOfId: null, ...(excludeCode ? { code: { not: excludeCode } } : {}) },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      code: true,
      label: true,
      bodega: true,
      components: { select: { catalogItemId: true, quantity: true, catalogItem: { select: { name: true, justCode: true, photos: true } } } },
    },
  });
  return combos.find((c) => c.components.length > 0 && recipeFingerprint(c.components) === fp) ?? null;
}

type MotherCombo = NonNullable<Awaited<ReturnType<typeof findMotherComboByRecipe>>>;

// Pedido del usuario 2026-10-10: nunca se une solo. Si la receta ya existe
// con otro ID, se le muestra a quien registra cuál es para que confirme que
// es el mismo combo (si no, se equivocó al escribir la receta y la corrige).
export function confirmAliasResponse(mother: MotherCombo) {
  return {
    error: `Este combo ya existe con el ID ${mother.code}. Confirma si es el mismo combo.`,
    needsAliasConfirm: true,
    mother: {
      code: mother.code,
      label: mother.label,
      bodega: mother.bodega,
      components: mother.components.map((c) => ({ quantity: c.quantity, name: c.catalogItem.name, justCode: c.catalogItem.justCode, photo: c.catalogItem.photos[0] ?? null })),
    },
  };
}

// Tras cambiar la receta o la marca de un combo madre, sus IDs alternos
// quedan iguales (guardan una copia para que todo lo que busca por código
// siga funcionando).
export async function syncComboAliases(tx: Prisma.TransactionClient, motherId: string): Promise<void> {
  const mother = await tx.dropiCombo.findUnique({
    where: { id: motherId },
    select: { bodega: true, components: { select: { catalogItemId: true, quantity: true } }, aliases: { select: { id: true } } },
  });
  if (!mother || mother.aliases.length === 0) return;
  const ids = mother.aliases.map((a) => a.id);
  await tx.dropiComboComponent.deleteMany({ where: { comboId: { in: ids } } });
  await tx.dropiComboComponent.createMany({ data: ids.flatMap((comboId) => mother.components.map((c) => ({ comboId, catalogItemId: c.catalogItemId, quantity: c.quantity }))) });
  await tx.dropiCombo.updateMany({ where: { id: { in: ids } }, data: { bodega: mother.bodega } });
}

// Pedido del usuario 2026-10-10: la marca de un combo la decide el asesor que
// lo publica en Dropi, no Daniel. Si el combo vino en el PDF de una marca, se
// toma esa (es la cuenta donde se publicó). Si vino en un PDF "SinMarca"
// (Dropi lo arma para lo publicado sin el campo Marca), el corte se guarda
// igual, la asesora B2B la elige desde su Inicio y Bryan (líder de Análisis
// de Mercado) recibe un aviso para saber qué pasa en su área.
export async function canSetMissingComboBrand(): Promise<boolean> {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  // Mismo permiso del rol de la asesora B2B que crea los combos en Dropi.
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { canMarkComboCreatedInDropi: true } });
  return !!user?.canMarkComboCreatedInDropi;
}

export async function notifyCombosWithoutBrand(combos: { code: string; label: string | null }[]): Promise<void> {
  if (combos.length === 0) return;
  const [advisors, leaders, title] = await Promise.all([
    prisma.user.findMany({ where: { canMarkComboCreatedInDropi: true, isActive: true }, select: { id: true } }),
    prisma.user.findMany({ where: { isActive: true, isLeader: true, leadsDept: { code: "MKT" } }, select: { id: true } }),
    getB2BAdvisorTitle(),
  ]);
  const list = combos.map((c) => `${c.code}${c.label ? ` (${c.label})` : ""}`).join(", ");
  const plural = combos.length > 1;
  await Promise.all([
    ...advisors.map((u) =>
      notifyOwner(u.id, {
        title: plural ? "Combos sin marca: elige su marca" : "Combo sin marca: elige su marca",
        body: `${list} se vendió en Dropi sin marca (PDF "SinMarca"). Elige a qué marca pertenece en Stock Actual.`,
        url: COMBO_BRAND_HREF,
      }).catch(() => null)
    ),
    ...leaders.map((u) =>
      notifyOwner(u.id, {
        title: plural ? "Combos vendidos sin marca en Dropi" : "Combo vendido sin marca en Dropi",
        body: `${list} se publicó en Dropi sin marca. ${b2bAdvisorWithArticle(title).replace(/^./, (ch) => ch.toUpperCase())} ya tiene el pendiente de elegirla.`,
        url: COMBO_BRAND_HREF,
      }).catch(() => null)
    ),
  ]);
}

export const COMBO_BRAND_HREF = "/area/workspace?tab=stock-actual&filtro=combos-sin-marca";

// Mensaje para cuando alguien intenta cambiar directamente un ID alterno.
export function aliasEditMessage(code: string, motherCode: string): string {
  return `El ${code} es un ID alterno del combo ${motherCode} — su receta y su marca son las del ${motherCode}. Corrige el ${motherCode}.`;
}
