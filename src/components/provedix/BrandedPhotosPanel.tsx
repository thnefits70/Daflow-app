"use client";

import { useCallback, useEffect, useState } from "react";
import { compressImage } from "@/lib/compressImage";
import { uploadFile } from "@/lib/uploadFile";
import { brandLabel } from "@/lib/brandLabels";

type Row = {
  catalogItemId: string;
  code: string;
  name: string;
  brand: string | null;
  photo: string | null;
  brandedPhotoUrl: string | null;
  rank: number;
  unitsRange: string;
};

// Pedido del usuario 2026-10-10: Robert sube la foto brandeada (con la marca
// que corresponde) de los productos que más se venden, para la página
// provedix.com. Mientras falte, la página usa la foto normal del catálogo.
export function BrandedPhotosPanel() {
  const [data, setData] = useState<{ canEdit: boolean; rows: Row[] } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/provedix/branded-photos").catch(() => null);
    if (!res?.ok) {
      setHidden(true);
      return;
    }
    setData(await res.json());
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/provedix/branded-photos")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => alive && setData(d))
      .catch(() => alive && setHidden(true));
    return () => {
      alive = false;
    };
  }, []);

  // existingUrl: "la foto actual ya está brandeada" — se usa esa, sin subir nada.
  async function save(row: Row, file: File | null, existingUrl?: string) {
    setBusy(row.catalogItemId);
    setError(null);
    let url: string | null = existingUrl ?? null;
    if (file) {
      const up = await uploadFile(await compressImage(file, 1200), "branded-photos");
      if (!up.ok) {
        setBusy(null);
        setError(up.error);
        return;
      }
      url = up.url;
    }
    const res = await fetch("/api/provedix/branded-photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogItemId: row.catalogItemId, url }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setError("No se pudo guardar la foto. Vuelve a intentar.");
      return;
    }
    await load();
  }

  // Pedido del usuario 2026-10-10: cuando todos los ganadores ya tienen su foto
  // brandeada, esta lista desaparece (los nuevos la traen del paso de Dropi).
  if (hidden || (data && !data.rows.some((r) => !r.brandedPhotoUrl))) return null;

  const missing = data?.rows.filter((r) => !r.brandedPhotoUrl) ?? [];
  const done = data?.rows.filter((r) => r.brandedPhotoUrl) ?? [];
  const list = showDone ? done : missing;

  return (
    <div className="bg-surface border border-rule rounded-lg p-5 mt-6">
      <div className="text-[13px] font-semibold">Fotos brandeadas para provedix.com</div>
      <div className="text-[11.5px] text-steel mt-0.5 mb-3">
        Productos que más se venden, en orden. Sube la foto con la marca que le corresponde (Provedix o Imp. Damián). Mientras falte, la página
        muestra la foto normal.
      </div>
      {!data && <div className="text-[12px] text-steel">Cargando…</div>}
      {data && (
        <>
          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={() => setShowDone(false)}
              className={`rounded-full px-3 py-1 text-[11.5px] font-semibold border cursor-pointer ${!showDone ? "bg-teal/15 border-teal/40 text-teal" : "border-rule text-steel"}`}
            >
              Faltan ({missing.length})
            </button>
            <button
              type="button"
              onClick={() => setShowDone(true)}
              className={`rounded-full px-3 py-1 text-[11.5px] font-semibold border cursor-pointer ${showDone ? "bg-teal/15 border-teal/40 text-teal" : "border-rule text-steel"}`}
            >
              Ya subidas ({done.length})
            </button>
          </div>
          {error && <div className="text-[12px] text-red mb-2">{error}</div>}
          {list.length === 0 && <div className="text-[12px] text-steel">{showDone ? "Todavía no hay fotos subidas." : "¡Todos los ganadores ya tienen su foto brandeada!"}</div>}
          <div className="flex flex-col divide-y divide-rule">
            {list.map((r) => (
              <div key={r.catalogItemId} className="flex items-center gap-3 py-2.5">
                <span className="font-mono text-[10.5px] text-steel w-8 shrink-0">#{r.rank}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.brandedPhotoUrl ?? r.photo ?? ""} alt="" className="w-12 h-12 rounded object-cover bg-cloud shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium truncate">{r.name}</div>
                  <div className="text-[10.5px] text-steel font-mono">
                    ID {r.code}
                    {r.brand ? ` · ${brandLabel(r.brand)}` : ""} · {r.unitsRange} unid./30 días
                  </div>
                </div>
                {data.canEdit && (
                  <div className="flex items-center gap-2 shrink-0">
                    <label
                      className={`rounded-md border border-rule bg-cloud px-3 py-1.5 text-[11.5px] font-semibold ${busy ? "opacity-60" : "cursor-pointer hover:bg-surface"}`}
                    >
                      {busy === r.catalogItemId ? "Subiendo…" : r.brandedPhotoUrl ? "Cambiar foto" : "Subir foto brandeada"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={!!busy}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) save(r, f);
                        }}
                      />
                    </label>
                    {!r.brandedPhotoUrl && r.photo && (
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => save(r, null, r.photo!)}
                        className="rounded-md border border-teal/40 px-3 py-1.5 text-[11.5px] font-semibold text-teal hover:bg-teal/10 cursor-pointer disabled:opacity-60"
                      >
                        La foto actual ya está brandeada
                      </button>
                    )}
                    {r.brandedPhotoUrl && (
                      <button type="button" disabled={!!busy} onClick={() => save(r, null)} className="text-[11px] text-steel hover:text-red cursor-pointer">
                        Quitar
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
