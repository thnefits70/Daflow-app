import { prisma } from "@/lib/prisma";
import type { MarketProductBodega } from "@/generated/prisma/client";
import type { ManifestBrandConflict } from "@/lib/manifestBrand";
import { syncComboAliases } from "@/lib/comboAlias";
import { notifyOwner } from "@/lib/notifications";

// Pedido del usuario 2026-10-14: antes los IDs con una marca puesta que
// venían en el manifiesto de OTRA marca solo se veían si el admin pulsaba
// "Revisar manifiestos ya subidos". Ahora cada subida los guarda y la asesora
// B2B decide (dejarla o cambiarla). Una sola decisión por ID: si después
// vuelve a no coincidir, le toca al admin para ver qué está pasando.

export const MANIFEST_BRAND_CONFLICTS_HREF = "/area/workspace?tab=stock-actual&filtro=marcas-no-coinciden";

export const BRAND_NAMES: Record<MarketProductBodega, string> = {
  MKT_PROVEDIX: "Provedix",
  MKT_DAMIAN: "Importadora Damián",
  MKT_SHANGHAI: "Importadora Shanghai",
  MKT_SUMINISTROS: "Suministros",
};

export async function recordManifestBrandConflicts(conflicts: ManifestBrandConflict[]): Promise<void> {
  if (conflicts.length === 0) return;
  const codes = [...new Set(conflicts.map((c) => c.code))];
  const existing = await prisma.manifestBrandConflict.findMany({
    where: { code: { in: codes } },
    select: { kind: true, code: true, storedBrand: true, manifestBrand: true, resolution: true },
  });
  const key = (c: { kind: string; code: string; storedBrand: string; manifestBrand: string }) => `${c.kind}|${c.code}|${c.storedBrand}|${c.manifestBrand}`;
  const seen = new Set(existing.map(key));
  const decided = new Set(existing.filter((e) => e.resolution === "KEPT" || e.resolution === "CHANGED").map((e) => `${e.kind}|${e.code}`));

  const fresh = conflicts
    .map((c) => ({ kind: c.kind, code: c.code, name: c.name, storedBrand: c.stored, manifestBrand: c.manifest }))
    .filter((c, i, all) => !seen.has(key(c)) && all.findIndex((x) => key(x) === key(c)) === i);
  if (fresh.length === 0) return;

  const rows = fresh.map((c) => ({ kind: c.kind, code: c.code, storedBrand: c.storedBrand, manifestBrand: c.manifestBrand, forAdmin: decided.has(`${c.kind}|${c.code}`) }));
  await prisma.manifestBrandConflict.createMany({ data: rows, skipDuplicates: true });

  const forAdvisor = fresh.filter((c) => !decided.has(`${c.kind}|${c.code}`));
  if (forAdvisor.length === 0) return;
  const advisors = await prisma.user.findMany({ where: { canMarkComboCreatedInDropi: true, isActive: true }, select: { id: true } });
  const first = forAdvisor[0];
  const body =
    forAdvisor.length === 1
      ? `${first.kind === "combo" ? "El combo" : "El producto"} ${first.code} está marcado como ${BRAND_NAMES[first.storedBrand]}, pero vino en el manifiesto de ${BRAND_NAMES[first.manifestBrand]}. Revisa cuál es la correcta.`
      : `${forAdvisor.length} IDs vinieron en el manifiesto de otra marca. Revisa cuál es la correcta.`;
  await Promise.all(
    advisors.map((u) => notifyOwner(u.id, { title: "Marca que no coincide con el manifiesto", body, url: MANIFEST_BRAND_CONFLICTS_HREF }).catch(() => null))
  );
}

export type OpenManifestBrandConflict = {
  id: string;
  kind: "producto" | "combo";
  code: string;
  name: string;
  storedBrand: MarketProductBodega;
  manifestBrand: MarketProductBodega;
  forAdmin: boolean;
  createdAt: string;
  previous: { resolution: string; storedBrand: MarketProductBodega; manifestBrand: MarketProductBodega; resolvedByName: string | null; resolvedAt: string }[];
};

// Los abiertos que le tocan a esta persona. Si la marca ya cambió por otro
// lado (ya no es la que estaba al detectarlo), el caso se cierra solo.
export async function getOpenManifestBrandConflicts(forAdmin: boolean): Promise<OpenManifestBrandConflict[]> {
  const rows = await prisma.manifestBrandConflict.findMany({ where: { resolvedAt: null, ...(forAdmin ? {} : { forAdmin: false }) }, orderBy: { createdAt: "asc" } });
  if (rows.length === 0) return [];
  const codes = [...new Set(rows.map((r) => r.code))];
  const [combos, products, history] = await Promise.all([
    prisma.dropiCombo.findMany({ where: { code: { in: codes }, aliasOfId: null }, select: { code: true, label: true, bodega: true } }),
    prisma.purchaseCatalogItem.findMany({ where: { justCode: { in: codes } }, select: { justCode: true, name: true, bodega: true } }),
    prisma.manifestBrandConflict.findMany({ where: { code: { in: codes }, resolution: { in: ["KEPT", "CHANGED"] } }, orderBy: { resolvedAt: "asc" } }),
  ]);
  const current = (kind: string, code: string) =>
    kind === "combo"
      ? (() => {
          const c = combos.find((x) => x.code === code);
          return c ? { name: c.label ?? c.code, brand: c.bodega } : null;
        })()
      : (() => {
          const p = products.find((x) => x.justCode === code);
          return p ? { name: p.name, brand: p.bodega } : null;
        })();

  const stale: string[] = [];
  const out: OpenManifestBrandConflict[] = [];
  for (const r of rows) {
    const now = current(r.kind, r.code);
    if (!now || now.brand !== r.storedBrand) {
      stale.push(r.id);
      continue;
    }
    out.push({
      id: r.id,
      kind: r.kind as "producto" | "combo",
      code: r.code,
      name: now.name,
      storedBrand: r.storedBrand,
      manifestBrand: r.manifestBrand,
      forAdmin: r.forAdmin,
      createdAt: r.createdAt.toISOString(),
      previous: history
        .filter((h) => h.kind === r.kind && h.code === r.code)
        .map((h) => ({ resolution: h.resolution ?? "", storedBrand: h.storedBrand, manifestBrand: h.manifestBrand, resolvedByName: h.resolvedByName, resolvedAt: h.resolvedAt!.toISOString() })),
    });
  }
  if (stale.length) {
    await prisma.manifestBrandConflict
      .updateMany({ where: { id: { in: stale }, resolvedAt: null }, data: { resolvedAt: new Date(), resolution: "OUTDATED", resolvedByName: "La marca ya había cambiado" } })
      .catch(() => null);
  }
  return out;
}

export async function resolveManifestBrandConflict(
  id: string,
  action: "KEEP" | "CHANGE",
  actor: { isAdmin: boolean; userId: string | null; name: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await prisma.manifestBrandConflict.findUnique({ where: { id } });
  if (!row || row.resolvedAt) return { ok: false, error: "Este caso ya fue resuelto." };
  if (row.forAdmin && !actor.isAdmin) return { ok: false, error: "Este ID ya tuvo una decisión — ahora lo revisa el administrador." };

  const done = { resolvedAt: new Date(), resolvedById: actor.userId, resolvedByName: actor.name, resolution: action === "KEEP" ? "KEPT" : "CHANGED" };
  if (action === "KEEP") {
    await prisma.manifestBrandConflict.update({ where: { id }, data: done });
    return { ok: true };
  }

  return prisma.$transaction(async (tx) => {
    if (row.kind === "combo") {
      const combo = await tx.dropiCombo.findFirst({ where: { code: row.code, aliasOfId: null }, select: { id: true, bodega: true } });
      if (!combo) return { ok: false as const, error: "Ese combo ya no existe." };
      if (combo.bodega !== row.storedBrand) return { ok: false as const, error: "La marca de este combo ya cambió." };
      await tx.dropiCombo.update({ where: { id: combo.id }, data: { bodega: row.manifestBrand } });
      await syncComboAliases(tx, combo.id);
    } else {
      const item = await tx.purchaseCatalogItem.findFirst({ where: { justCode: row.code }, select: { id: true, bodega: true } });
      if (!item) return { ok: false as const, error: "Ese producto ya no existe." };
      if (item.bodega !== row.storedBrand) return { ok: false as const, error: "La marca de este producto ya cambió." };
      await tx.purchaseCatalogItem.update({ where: { id: item.id }, data: { bodega: row.manifestBrand } });
    }
    await tx.manifestBrandConflict.update({ where: { id }, data: done });
    return { ok: true as const };
  });
}
