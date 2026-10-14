"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { formatDateTime } from "@/lib/formatDateTime";

type Brand = "MKT_PROVEDIX" | "MKT_DAMIAN" | "MKT_SHANGHAI" | "MKT_SUMINISTROS";
type Conflict = {
  id: string;
  kind: "producto" | "combo";
  code: string;
  name: string;
  storedBrand: Brand;
  manifestBrand: Brand;
  forAdmin: boolean;
  previous: { resolution: string; storedBrand: Brand; manifestBrand: Brand; resolvedByName: string | null; resolvedAt: string }[];
};

const BRAND: Record<Brand, string> = {
  MKT_PROVEDIX: "Provedix",
  MKT_DAMIAN: "Importadora Damián",
  MKT_SHANGHAI: "Importadora Shanghai",
  MKT_SUMINISTROS: "Suministros",
};

function fromLink() {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("filtro") === "marcas-no-coinciden";
}

// Pedido del usuario 2026-10-14 — ver lib/manifestBrandConflicts.ts:
// reemplaza el botón "Revisar manifiestos ya subidos" del admin. Cada subida
// guarda sola los IDs cuya marca no coincide con su manifiesto; acá la
// asesora B2B decide una vez por ID, y si vuelve a pasar lo ve el admin.
export function ManifestBrandConflicts({ isAdmin, onChanged }: { isAdmin: boolean; onChanged: () => void }) {
  const [items, setItems] = useState<Conflict[]>([]);
  const [confirming, setConfirming] = useState<{ id: string; action: "KEEP" | "CHANGE" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  function load() {
    return fetch("/api/manifest-brand-conflicts")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => setItems(d?.items ?? []));
  }
  useEffect(() => {
    load().then(() => {
      if (fromLink()) setTimeout(() => boxRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    });
  }, []);

  async function resolve(id: string, action: "KEEP" | "CHANGE") {
    setBusy(true);
    setErr("");
    const r = await fetch("/api/manifest-brand-conflicts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) }).catch(() => null);
    if (!r?.ok) setErr((await r?.json().catch(() => null))?.error ?? "No se pudo guardar.");
    setBusy(false);
    setConfirming(null);
    await load();
    if (r?.ok && action === "CHANGE") onChanged();
  }

  if (items.length === 0) return null;

  return (
    <div ref={boxRef} className="border border-gold/60 bg-gold/10 rounded-md p-3 mb-3">
      <div className="flex items-center gap-1.5 text-[12.5px] font-bold mb-0.5">
        <AlertTriangle size={14} className="text-gold" /> Marcas que no coinciden con el manifiesto ({items.length})
      </div>
      <div className="text-[11.5px] text-steel mb-2">
        {isAdmin
          ? "Estos IDs vinieron en el manifiesto de otra marca. Los marcados \"Otra vez\" ya tuvieron una decisión de la asesora B2B — revisa qué está pasando."
          : "Estos IDs vinieron en el manifiesto de otra marca. Decide cuál es la correcta. Solo se decide una vez: si vuelve a pasar con el mismo ID, lo revisa el administrador."}
      </div>
      {err && <div className="text-red text-[12px] mb-2">{err}</div>}
      <div className="flex flex-col gap-2">
        {items.map((c) => (
          <div key={c.id} className="rounded-md border border-rule bg-cloud p-2 text-[12px]">
            <div>
              {c.forAdmin && <span className="mr-1.5 rounded bg-red/15 px-1.5 py-0.5 text-[10.5px] font-bold text-red">Otra vez</span>}
              {c.kind === "combo" ? "Combo" : "Producto"} <span className="font-mono font-bold">{c.code}</span> {c.name}
            </div>
            <div className="text-steel mt-0.5">
              Está marcado como <b className="text-ink">{BRAND[c.storedBrand]}</b>, pero vino en el manifiesto de <b className="text-ink">{BRAND[c.manifestBrand]}</b>.
            </div>
            {c.previous.map((p) => (
              <div key={p.resolvedAt} className="text-steel mt-0.5">
                Antes: {p.resolvedByName ?? "—"} {p.resolution === "CHANGED" ? `la cambió de ${BRAND[p.storedBrand]} a ${BRAND[p.manifestBrand]}` : `la dejó en ${BRAND[p.storedBrand]} (vino en ${BRAND[p.manifestBrand]})`} el {formatDateTime(p.resolvedAt)}.
              </div>
            ))}
            {confirming?.id === c.id ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="font-semibold">
                  {confirming.action === "CHANGE" ? `¿Cambiar a ${BRAND[c.manifestBrand]}?` : `¿Dejarlo en ${BRAND[c.storedBrand]}?`}
                </span>
                <button type="button" disabled={busy} onClick={() => resolve(c.id, confirming.action)} className="rounded bg-teal px-3 py-1 text-[12px] font-bold text-white cursor-pointer disabled:opacity-60">
                  Sí, confirmar
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirming(null)} className="text-[12px] font-semibold text-steel cursor-pointer">
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => setConfirming({ id: c.id, action: "KEEP" })} className="rounded border border-rule px-3 py-1 text-[12px] font-bold cursor-pointer">
                  Está bien: {BRAND[c.storedBrand]}
                </button>
                <button type="button" onClick={() => setConfirming({ id: c.id, action: "CHANGE" })} className="rounded border border-teal px-3 py-1 text-[12px] font-bold text-teal cursor-pointer">
                  Cambiar a {BRAND[c.manifestBrand]}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
