"use client";

import { useEffect, useState } from "react";
import { LinkIcon, AlertTriangle } from "lucide-react";
import { ProductMatchPicker, type ProductMatchResult } from "./ProductMatchPicker";

type LegacyItemDTO = {
  id: string;
  name: string;
  batchCode: string;
  createdAt: string;
  goodQty: number;
  damagedQty: number;
  photoUrl: string | null;
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { day: "2-digit", month: "short", year: "numeric" });
}

// Confirmado 2026-09-10 (pedido explícito del usuario): herramienta puntual
// para conectar al catálogo real los productos de Reingreso que quedaron
// sin vínculo antes del 2026-08-29 (cuando todavía se podía escribir el
// nombre a mano) — ver legacy-unlinked/route.ts. Autogateado: solo admin
// pasa el guard del GET, así que para cualquier otra persona esto
// simplemente no se muestra (mismo patrón que NichoBackfillButton), sin
// necesidad de pasar un prop nuevo por las 4 páginas que renderizan
// JustCatalogPanel.
export function LegacyUnlinkedItems() {
  const [items, setItems] = useState<LegacyItemDTO[] | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});

  function load() {
    fetch("/api/merchandise-reentry/legacy-unlinked")
      .then((r) => (r.ok ? r.json() : null))
      .then(setItems)
      .catch(() => setItems(null));
  }

  useEffect(load, []);

  async function confirmLink(itemId: string, result: ProductMatchResult) {
    setError((e) => ({ ...e, [itemId]: "" }));
    try {
      const res = await fetch(`/api/merchandise-reentry/items/${itemId}/legacy-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogItemId: result.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo vincular.");
      setLinkingId(null);
      load();
    } catch (e) {
      setError((prev) => ({ ...prev, [itemId]: e instanceof Error ? e.message : "No se pudo vincular." }));
    }
  }

  if (!items || items.length === 0) return null;

  return (
    <div className="bg-gold/10 border border-gold/35 rounded-md p-3.5 mb-5">
      <div className="flex items-center gap-1.5 text-[12px] font-bold mb-1" style={{ color: "#D9A441" }}>
        <AlertTriangle size={14} /> {items.length} producto{items.length === 1 ? "" : "s"} de Reingreso sin conectar al catálogo (de antes del 29 ago)
      </div>
      <div className="text-[11px] text-steel mb-2.5">
        Se registraron con el nombre escrito a mano, antes de que esto fuera obligatorio. Conéctalos aquí a su producto real para que muestren su código de Just/Dropi — no afecta nada de lo que ya pasó con ellos (aprobación, cierre, envío a Just).
      </div>
      <div className="flex flex-col gap-1.5 max-h-[24rem] overflow-y-auto">
        {items.map((item) => (
          <div key={item.id} className="bg-surface border border-rule rounded-md px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 text-[12px]">
                <span className="font-semibold">{item.name}</span>{" "}
                <span className="text-steel">
                  · <span className="font-mono">{item.batchCode}</span> · {fmt(item.createdAt)} · {item.goodQty} buenas
                  {item.damagedQty > 0 ? `, ${item.damagedQty} dañadas` : ""}
                </span>
              </div>
              {linkingId !== item.id && (
                <button
                  type="button"
                  className="shrink-0 flex items-center gap-1 rounded border border-teal bg-teal px-2.5 py-1 text-[11px] font-bold text-navy cursor-pointer"
                  onClick={() => setLinkingId(item.id)}
                >
                  <LinkIcon size={11} /> Vincular
                </button>
              )}
            </div>
            {error[item.id] && <div className="text-red text-[11px] mt-1.5">{error[item.id]}</div>}
            {linkingId === item.id && (
              <div className="mt-2">
                <ProductMatchPicker
                  referencePhotoUrl={item.photoUrl}
                  initialQuery={item.name}
                  searchUrl="/api/merchandise-reentry/legacy-catalog-search"
                  onConfirm={(result) => confirmLink(item.id, result)}
                  onCancel={() => setLinkingId(null)}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
