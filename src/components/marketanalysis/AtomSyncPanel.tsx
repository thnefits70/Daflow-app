"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { ProductMatchPicker, type ProductMatchResult } from "@/components/merchandise-reentry/ProductMatchPicker";

type PreviewRow = {
  productName: string;
  matchedItemId: string | null;
  matchedItemName: string | null;
  matchType: "exact" | "similar" | "none";
};

// Cada fila termina en uno de estos tres estados antes de poder confirmar:
// enlazada al catálogo (automático o corregido a mano), marcada como combo
// (sin enlace, un combo de Dropi no es un producto propio del catálogo), o
// sin resolver todavía.
type ResolvedRow = PreviewRow & { resolution: "linked" | "combo" | "pending"; linkedItemId: string | null };

// Confirmado 2026-08-31 (ver memoria project_atom_combo_suggestions_idea):
// nada de IA ni chat acá — alguien del equipo pega la tabla completa de ATOM
// tal cual la copió (Ctrl+A), y el servidor se encarga de separar los
// productos, quedarse solo con los marcados "Rentable" (ignora Seguimiento e
// Intervención) y compararlos contra el catálogo real.
export function AtomSyncPanel() {
  const router = useRouter();
  const [rawText, setRawText] = useState("");
  const [rows, setRows] = useState<ResolvedRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [linkingIndex, setLinkingIndex] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  async function handlePreview() {
    if (!rawText.trim()) {
      setErr("Pega el texto copiado de ATOM primero.");
      return;
    }
    setErr("");
    setBusy(true);
    setSavedAt(null);
    const res = await fetch("/api/atom-sync/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo leer el texto pegado.");
      return;
    }
    setRows(
      (data.preview as PreviewRow[]).map((r) => ({
        ...r,
        resolution: r.matchType === "none" ? "pending" : "linked",
        linkedItemId: r.matchedItemId,
      }))
    );
  }

  function markCombo(index: number) {
    setRows((prev) => prev!.map((r, i) => (i === index ? { ...r, resolution: "combo", linkedItemId: null } : r)));
    setLinkingIndex(null);
  }

  function setLink(index: number, result: ProductMatchResult) {
    setRows((prev) => prev!.map((r, i) => (i === index ? { ...r, resolution: "linked", linkedItemId: result.id, matchedItemName: result.name } : r)));
    setLinkingIndex(null);
  }

  async function handleConfirm() {
    if (!rows) return;
    if (rows.some((r) => r.resolution === "pending")) {
      setErr("Todavía hay productos sin resolver — marca cada uno como combo o búscalo en el catálogo.");
      return;
    }
    setErr("");
    setBusy(true);
    const res = await fetch("/api/atom-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: rows.map((r) => ({
          productName: r.productName,
          confirmedMatchedItemId: r.resolution === "linked" ? r.linkedItemId : null,
          isCombo: r.resolution === "combo",
        })),
      }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo guardar.");
      return;
    }
    setSavedAt(data.capturedAt);
    setRows(null);
    setRawText("");
    router.refresh();
  }

  return (
    <div>
      <div className="bg-surface border border-rule rounded-md p-4.5 mb-5">
        <label className="block mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
          Actualizar datos de ATOM
        </label>
        <div className="text-[11.5px] text-steel mb-2.5">
          En atomapp.com.co/productos, selecciona toda la tabla (Ctrl+A) y cópiala — puedes incluir todas las páginas. Pégala tal cual acá abajo. Solo se guardan los productos y combos marcados "Rentable" ese día.
        </div>
        <textarea
          className="w-full rounded border border-rule bg-surface px-3 py-2.5 text-[12.5px] font-mono resize-y"
          rows={8}
          placeholder="Pega aquí la tabla copiada de ATOM…"
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          disabled={busy || !!rows}
        />
        {err && <div className="text-red text-[12.5px] mt-2">{err}</div>}
        {savedAt && (
          <div className="inline-flex items-center gap-1.5 text-[12.5px] text-teal mt-2.5">
            <CheckCircle2 size={14} /> Guardado — lectura registrada.
          </div>
        )}
        {!rows && (
          <button
            type="button"
            disabled={busy}
            className="mt-2.5 rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60"
            onClick={handlePreview}
          >
            {busy ? "Leyendo…" : "Vista previa"}
          </button>
        )}
      </div>

      {rows && (
        <div className="bg-surface border border-rule rounded-md p-4.5">
          <div className="text-[12.5px] font-semibold mb-3">
            {rows.length} producto{rows.length === 1 ? "" : "s"} marcados "Rentable" en el texto pegado
          </div>
          <div className="flex flex-col gap-2">
            {rows.map((r, i) => (
              <div key={`${r.productName}-${i}`} className="border border-rule rounded p-2.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[12.5px] font-medium">{r.productName}</span>
                  {r.resolution === "linked" && (
                    <span className="text-[11px] text-teal font-semibold flex items-center gap-1">
                      <CheckCircle2 size={12} /> {r.matchedItemName ?? "enlazado"}
                    </span>
                  )}
                  {r.resolution === "combo" && <span className="text-[11px] text-blue font-semibold">Marcado como combo</span>}
                  {r.resolution === "pending" && <span className="text-[11px] text-red font-semibold">Sin resolver</span>}
                </div>
                {r.resolution !== "linked" || r.matchType === "none" ? (
                  <div className="flex gap-2 mt-1.5">
                    {r.resolution !== "combo" && (
                      <button type="button" className="text-[11px] text-blue font-semibold cursor-pointer" onClick={() => markCombo(i)}>
                        Es un combo
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-[11px] text-blue font-semibold cursor-pointer"
                      onClick={() => setLinkingIndex(linkingIndex === i ? null : i)}
                    >
                      {r.resolution === "linked" ? "Cambiar producto" : "Buscar en el catálogo"}
                    </button>
                  </div>
                ) : null}
                {linkingIndex === i && (
                  <div className="mt-2">
                    <ProductMatchPicker
                      referencePhotoUrl={null}
                      initialQuery={r.productName}
                      searchUrl="/api/combo-suggestions/catalog-search"
                      onConfirm={(result) => setLink(i, result)}
                      onCancel={() => setLinkingIndex(null)}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {err && <div className="text-red text-[12.5px] mt-3">{err}</div>}
          <div className="flex gap-2 mt-3.5">
            <button
              type="button"
              disabled={busy}
              className="rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60"
              onClick={handleConfirm}
            >
              {busy ? "Guardando…" : "Confirmar y guardar"}
            </button>
            <button
              type="button"
              className="rounded border border-rule px-3.5 py-2 text-[12.5px] font-semibold cursor-pointer"
              onClick={() => {
                setRows(null);
                setErr("");
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
