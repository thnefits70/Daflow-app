"use client";

import { useEffect, useState } from "react";
import { Palette } from "lucide-react";

type Row = { catalogItemId: string; name: string; justCode: string | null; photo: string | null; label: string; units: number; official: { id: string; name: string }[] };

// Pedido del usuario 2026-10-06: los colores/tallas que llegan en las guías
// escritos distinto a la lista oficial del conteo ("Gris7cafe") — Daniel
// dice a cuál corresponden una sola vez y DAFLOW lo recuerda.
export function GuideVariantReview() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/variant-aliases", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRows(Array.isArray(d) ? d : null))
      .catch(() => setRows(null));
  }
  useEffect(load, []);

  async function decide(r: Row, choice: { variantId?: string; newVariant?: boolean; ignore?: boolean }) {
    const key = `${r.catalogItemId}|${r.label}`;
    setBusy(key);
    setErr("");
    const res = await fetch("/api/variant-aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogItemId: r.catalogItemId, label: r.label, ...choice }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      const j = res ? await res.json().catch(() => null) : null;
      return setErr(j?.error ?? "No se pudo guardar.");
    }
    setRows((rs) => rs?.filter((x) => `${x.catalogItemId}|${x.label}` !== key) ?? rs);
  }

  if (!rows || rows.length === 0) return null;
  return (
    <section id="variantes" className="border border-gold rounded-md p-3 mb-4 max-w-3xl">
      <div className="font-semibold text-[13px] flex items-center gap-2 mb-1 text-gold">
        <Palette size={14} /> Colores/tallas de las guías por unir ({rows.length})
      </div>
      <div className="text-[12px] text-steel mb-2">
        En las guías llegaron escritos distinto a lo que contó tu equipo. Elige a cuál corresponde: DAFLOW lo recuerda y no vuelve a preguntar.
      </div>
      {err && <div className="text-red text-[12.5px] mb-2">{err}</div>}
      <div className="flex flex-col gap-2">
        {rows.map((r) => {
          const key = `${r.catalogItemId}|${r.label}`;
          return (
            <div key={key} className="border border-rule rounded p-2 text-[12.5px]">
              <div className="flex items-center gap-2">
                {r.photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img loading="lazy" decoding="async" src={r.photo} alt="" className="w-9 h-9 rounded object-cover shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="font-semibold truncate">{r.name}</div>
                  <div className="text-steel">
                    En las guías llegó <b className="text-ink">«{r.label}»</b> ({r.units} vendida{r.units === 1 ? "" : "s"}). ¿A cuál corresponde?
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {r.official.map((v) => (
                  <button key={v.id} type="button" disabled={busy === key} className="rounded-full border border-teal px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-teal/15 cursor-pointer disabled:opacity-50" onClick={() => decide(r, { variantId: v.id })}>
                    {v.name}
                  </button>
                ))}
                <button type="button" disabled={busy === key} className="rounded-full border border-rule px-2.5 py-1 text-[12px] text-ink cursor-pointer disabled:opacity-50" onClick={() => decide(r, { newVariant: true })}>
                  Es un color/talla nuevo
                </button>
                <button type="button" disabled={busy === key} className="rounded-full border border-rule px-2.5 py-1 text-[12px] text-steel cursor-pointer disabled:opacity-50" onClick={() => decide(r, { ignore: true })}>
                  No es un color/talla
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
