"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";

export type MatchCatalogItem = { id: string; name: string; photos: string[]; justCode: string | null; pendingRegistration: boolean };
// Confirmado 2026-08-29 (pedido explícito del usuario): se quitó "escribir
// el nombre a mano" — ya no existe una salida sin vincular al catálogo real,
// así que el resultado SIEMPRE es un producto del catálogo. Si no lo
// encuentra, la persona reporta el faltante (ver "no encontrado" abajo) en
// vez de inventar un nombre; el formulario que la contiene se queda sin
// producto elegido hasta que alguien agregue el producto real.
export type ProductMatchResult = MatchCatalogItem;

// Compartido entre AddItemForm (agregar producto nuevo al lote), la edición
// de un producto ya agregado (mientras el lote sigue en borrador) y la
// re-vinculación de Daniel en Revisión — confirmado 2026-08-23 (pedido
// explícito del usuario): la vinculación a un producto del catálogo SIEMPRE
// pasa por una doble confirmación antes de quedar hecha, en los tres
// lugares, con el mismo comportamiento.
export function ProductMatchPicker({
  referencePhotoUrl,
  initialQuery = "",
  searchUrl = "/api/merchandise-reentry/catalog-search",
  onConfirm,
  onCancel,
}: {
  referencePhotoUrl: string | null;
  initialQuery?: string;
  // Confirmado 2026-08-27: mismo picker reutilizado fuera de Inventario
  // (ej. Compras Personales) — cada consumidor apunta a su propio endpoint
  // de búsqueda porque el guard de autorización varía según quién puede
  // usar ese flujo, aunque todos lean del mismo PurchaseCatalogItem.
  searchUrl?: string;
  onConfirm: (result: ProductMatchResult) => void;
  onCancel?: () => void;
}) {
  const [catalog, setCatalog] = useState<MatchCatalogItem[] | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [reporting, setReporting] = useState(false);
  const [reportNote, setReportNote] = useState("");
  const [reportSaving, setReportSaving] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reported, setReported] = useState(false);
  const [confirming, setConfirming] = useState<MatchCatalogItem | null>(null);

  async function sendMissingReport() {
    setReportSaving(true);
    setReportError("");
    try {
      const res = await fetch("/api/catalog-missing-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, note: reportNote.trim() || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "No se pudo enviar el aviso.");
      setReported(true);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "No se pudo enviar el aviso.");
    } finally {
      setReportSaving(false);
    }
  }

  useEffect(() => {
    fetch(searchUrl)
      .then((r) => (r.ok ? r.json() : []))
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, [searchUrl]);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const suggestions =
    words.length === 0
      ? []
      : (catalog ?? [])
          .filter((c) => words.every((w) => c.name.toLowerCase().includes(w) || (!!c.justCode && c.justCode.toLowerCase().includes(w))))
          .slice(0, 6);

  if (confirming) {
    return (
      <div className="bg-cloud rounded-md p-3">
        <div className="text-[12px] font-semibold mb-2">¿Es este el producto correcto?</div>
        <div className="flex items-center gap-2.5 mb-2.5">
          {referencePhotoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={referencePhotoUrl} alt="Foto del reingreso" className="w-14 h-14 object-cover rounded border border-rule" />
          )}
          {confirming.photos[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={confirming.photos[0]} alt={confirming.name} className="w-14 h-14 object-cover rounded border border-green/40" />
          ) : (
            <div className="w-14 h-14 rounded border border-dashed border-rule flex items-center justify-center text-steel" title="Este producto del catálogo todavía no tiene foto de referencia">
              <Clock size={16} />
            </div>
          )}
        </div>
        <div className="text-[12.5px] font-semibold mb-2.5 flex items-center gap-1.5 flex-wrap">
          <CatalogCode code={confirming.justCode} />
          <span>{confirming.name}</span>
        </div>
        <div className="flex gap-2">
          <button type="button" className="flex-1 rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer" onClick={() => onConfirm(confirming)}>
            Sí, es el mismo producto
          </button>
          <button type="button" className="flex-1 rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer" onClick={() => setConfirming(null)}>
            No, buscar otro
          </button>
        </div>
      </div>
    );
  }

  if (reporting) {
    if (reported) {
      return (
        <div className="bg-cloud rounded-md p-3">
          <div className="text-[12.5px] font-semibold text-teal mb-1">Le avisamos a quien administra el catálogo.</div>
          <div className="text-[11.5px] text-steel mb-2">Te contactamos cuando "{query}" esté agregado — mientras tanto no podés continuar con este producto.</div>
          <button
            type="button"
            className="text-[11px] text-blue font-semibold cursor-pointer"
            onClick={() => {
              setReporting(false);
              setReported(false);
              setReportNote("");
            }}
          >
            Buscar de nuevo
          </button>
        </div>
      );
    }
    return (
      <div className="bg-cloud rounded-md p-3">
        <div className="text-[12px] font-semibold mb-1">No encontramos "{query}" en el catálogo</div>
        <div className="text-[11px] text-steel mb-2">Le avisamos a Daniel/admin para que lo agreguen — no se puede escribir el nombre a mano.</div>
        <textarea
          placeholder="Nota opcional (marca, dónde lo viste, etc.)"
          className="w-full rounded border border-rule bg-surface px-2.5 py-2 text-[12.5px] mb-2 resize-none"
          rows={2}
          value={reportNote}
          onChange={(e) => setReportNote(e.target.value)}
        />
        {reportError && <div className="text-red text-[11px] mb-1.5">{reportError}</div>}
        <div className="flex gap-1.5 flex-wrap">
          <button
            type="button"
            disabled={reportSaving}
            className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-50"
            onClick={sendMissingReport}
          >
            {reportSaving ? "Enviando…" : "Avisar que falta"}
          </button>
          <button type="button" className="text-[11px] text-blue font-semibold cursor-pointer" onClick={() => setReporting(false)}>
            Buscar en el catálogo en cambio
          </button>
          {onCancel && (
            <button type="button" className="text-[11px] text-steel cursor-pointer" onClick={onCancel}>
              Cancelar
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-cloud rounded-md p-3">
      <input
        type="text"
        autoFocus
        placeholder="Buscá por nombre o código de Just…"
        className="w-full rounded border border-rule bg-surface px-2.5 py-2 text-[12.5px]"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {catalog === null && <div className="text-[11.5px] text-steel mt-1">Cargando catálogo…</div>}
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-1 mt-1.5 border border-rule rounded-md overflow-hidden">
          {suggestions.map((c) => (
            <button key={c.id} type="button" className="flex items-center gap-2.5 p-2 hover:bg-surface cursor-pointer text-left" onClick={() => setConfirming(c)}>
              {c.photos[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.photos[0]} alt={c.name} className="w-9 h-9 object-cover rounded border border-rule shrink-0" />
              ) : (
                <div className="w-9 h-9 rounded border border-dashed border-rule shrink-0 flex items-center justify-center text-steel">
                  <Clock size={13} />
                </div>
              )}
              <span className="text-[12.5px] font-medium flex-1 flex items-center gap-1.5 flex-wrap min-w-0">
                <CatalogCode code={c.justCode} />
                <span className="truncate">{c.name}</span>
              </span>
              {c.pendingRegistration && (
                <span className="shrink-0 font-mono text-[9px] font-bold uppercase rounded-full px-1.5 py-0.5 bg-gold/15 border border-gold/40" style={{ color: "#D9A441" }}>
                  Sin foto
                </span>
              )}
              <CheckCircle2 size={13} className="text-teal shrink-0" />
            </button>
          ))}
        </div>
      )}
      {words.length > 0 && suggestions.length === 0 && catalog !== null && (
        <div className="text-[11.5px] text-steel mt-1">No se encontró nada con esas palabras.</div>
      )}
      <div className="flex gap-1.5 flex-wrap mt-1.5">
        {words.length > 0 && suggestions.length === 0 && catalog !== null && (
          <button type="button" className="text-[11px] text-blue font-semibold cursor-pointer" onClick={() => setReporting(true)}>
            No lo encuentro — avisar que falta
          </button>
        )}
        {onCancel && (
          <button type="button" className="text-[11px] text-steel cursor-pointer" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}
