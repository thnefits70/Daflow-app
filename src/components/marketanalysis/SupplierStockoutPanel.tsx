"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/formatDateTime";
import { TabGuide } from "@/components/shared/TabGuide";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { ProductMatchPicker, type MatchCatalogItem } from "@/components/merchandise-reentry/ProductMatchPicker";

type ResolutionAction = "CLOSED_DROPI_ID" | "STOCK_ZEROED" | "OTHER";

type Report = {
  id: string;
  catalogItem: { id: string; name: string; photos: string[]; justCode: string | null };
  instructionNote: string;
  reportedBy: { name: string } | null;
  reportedAt: string;
  resolution: ResolutionAction | null;
  resolutionNote: string | null;
  resolvedBy: { name: string } | null;
  resolvedAt: string | null;
};

const RESOLUTION_LABELS: Record<ResolutionAction, string> = {
  CLOSED_DROPI_ID: "Cerró el ID en Dropi",
  STOCK_ZEROED: "Bajó el stock a 0",
  OTHER: "Otro",
};

// Confirmado 2026-09-23, pedido de Jariel (vía el usuario): cuando busca un
// producto ya registrado y ningún proveedor lo tiene, lo reporta con un
// clic + una nota propia de qué debe hacer el equipo (bajar el stock,
// cerrar el ID, etc.) — antes esto se avisaba por fuera del sistema
// (WhatsApp/llamada), sin quedar registro. Heidy y Bryan resuelven con una
// lista fija (para poder contar después cuántas veces se hizo cada cosa),
// el resto del equipo de Análisis de Mercado ve todo en solo lectura.
export function SupplierStockoutPanel({ canReport, canResolve }: { canReport: boolean; canResolve: boolean }) {
  const [rows, setRows] = useState<Report[] | null>(null);

  const [reporting, setReporting] = useState(false);
  const [selected, setSelected] = useState<MatchCatalogItem | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState("");

  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolution, setResolution] = useState<ResolutionAction | "">("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [resolveSaving, setResolveSaving] = useState(false);
  const [resolveErr, setResolveErr] = useState("");

  function load() {
    fetch("/api/supplier-stockout-reports")
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows)
      .catch(() => setRows([]));
  }
  useEffect(load, []);

  function resetForm() {
    setReporting(false);
    setSelected(null);
    setNote("");
    setFormErr("");
  }

  async function submitReport() {
    if (!selected || !note.trim()) return;
    setSaving(true);
    setFormErr("");
    try {
      const res = await fetch("/api/supplier-stockout-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogItemId: selected.id, instructionNote: note.trim() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "No se pudo enviar el reporte.");
      resetForm();
      load();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : "No se pudo enviar el reporte.");
    } finally {
      setSaving(false);
    }
  }

  function resetResolve() {
    setResolvingId(null);
    setResolution("");
    setResolutionNote("");
    setResolveErr("");
  }

  async function submitResolve(id: string) {
    if (!resolution || (resolution === "OTHER" && !resolutionNote.trim())) return;
    setResolveSaving(true);
    setResolveErr("");
    try {
      const res = await fetch(`/api/supplier-stockout-reports/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution, resolutionNote: resolutionNote.trim() || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "No se pudo marcar resuelto.");
      resetResolve();
      load();
    } catch (e) {
      setResolveErr(e instanceof Error ? e.message : "No se pudo marcar resuelto.");
    } finally {
      setResolveSaving(false);
    }
  }

  if (rows === null) return <div className="text-steel text-[13.5px]">Cargando…</div>;
  const pending = rows.filter((r) => !r.resolvedAt);
  const resolved = rows.filter((r) => r.resolvedAt);

  return (
    <div>
      <TabGuide storageKey="analisismercado-sinstock">
        {canReport ? (
          <>
            Reportá acá un producto que ya no consigues con ningún proveedor. Elegilo del catálogo y escribí una nota de qué debe hacer el equipo (bajar el
            stock, cerrar el ID en Dropi, etc.) — le llega de una a Heidy y a Bryan.
          </>
        ) : canResolve ? (
          <>
            Acá te llegan los productos que Compras ya no consigue con ningún proveedor, con la nota de qué pide Jariel. Hacé lo que corresponda y marcalo
            resuelto.
          </>
        ) : (
          <>Vista de solo lectura: productos que Compras ya no consigue con ningún proveedor, y cómo se resolvió cada uno.</>
        )}
      </TabGuide>

      {canReport && (
        <div className="mb-5.5">
          {!reporting ? (
            <button
              type="button"
              className="rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer"
              onClick={() => setReporting(true)}
            >
              + Reportar producto sin stock
            </button>
          ) : (
            <div className="max-w-lg bg-surface border border-rule rounded-md p-3.5">
              <div className="text-[13px] font-semibold mb-2.5">Reportar producto sin stock de proveedor</div>
              {!selected ? (
                <ProductMatchPicker
                  referencePhotoUrl={null}
                  searchUrl="/api/supplier-stockout-reports/catalog-search"
                  onConfirm={setSelected}
                  onCancel={resetForm}
                />
              ) : (
                <>
                  <div className="flex items-center gap-2.5 mb-2.5">
                    {selected.photos[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={selected.photos[0]} alt={selected.name} className="w-12 h-12 object-cover rounded border border-rule shrink-0" />
                    ) : null}
                    <span className="text-[12.5px] font-semibold flex items-center gap-1.5 flex-wrap min-w-0">
                      <CatalogCode code={selected.justCode} />
                      <span className="truncate">{selected.name}</span>
                    </span>
                    <button type="button" className="text-[11px] text-blue font-semibold cursor-pointer ml-auto shrink-0" onClick={() => setSelected(null)}>
                      Cambiar
                    </button>
                  </div>
                  <label className="block text-[11px] font-semibold text-steel mb-1">¿Qué debe hacer el equipo?</label>
                  <textarea
                    autoFocus
                    placeholder="Ej: bajen el stock a 0, o cierren este ID en Dropi…"
                    className="w-full rounded border border-rule bg-cloud px-2.5 py-2 text-[12.5px] mb-2 resize-none"
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  {formErr && <div className="text-red text-[11px] mb-1.5">{formErr}</div>}
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={saving || !note.trim()}
                      className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-50"
                      onClick={submitReport}
                    >
                      {saving ? "Enviando…" : "Enviar aviso"}
                    </button>
                    <button type="button" className="rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer" onClick={resetForm}>
                      Cancelar
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="font-display font-bold text-[14px] mb-2.5">Pendientes ({pending.length})</div>
      {pending.length === 0 ? (
        <div className="text-steel text-[13px] mb-6">Nada pendiente.</div>
      ) : (
        <div className="flex flex-col gap-2.5 mb-6">
          {pending.map((r) => (
            <div key={r.id} className="bg-surface border border-rule rounded-md p-3.5">
              <div className="flex items-center gap-2.5 mb-1.5">
                {r.catalogItem.photos[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.catalogItem.photos[0]} alt={r.catalogItem.name} className="w-10 h-10 object-cover rounded border border-rule shrink-0" />
                ) : null}
                <div className="text-[13px] font-semibold flex items-center gap-1.5 flex-wrap min-w-0">
                  <CatalogCode code={r.catalogItem.justCode} />
                  <span className="truncate">{r.catalogItem.name}</span>
                </div>
              </div>
              <div className="text-[12.5px] text-ink mb-1.5">{r.instructionNote}</div>
              <div className="text-[11px] text-steel mb-2">
                Reportó {r.reportedBy?.name ?? "—"} · {formatDateTime(r.reportedAt)}
              </div>
              {canResolve &&
                (resolvingId === r.id ? (
                  <div className="bg-cloud rounded p-2.5">
                    <div className="flex flex-col gap-1 mb-2">
                      {(Object.keys(RESOLUTION_LABELS) as ResolutionAction[]).map((opt) => (
                        <label key={opt} className="flex items-center gap-1.5 text-[12px] cursor-pointer">
                          <input type="radio" name={`resolution-${r.id}`} checked={resolution === opt} onChange={() => setResolution(opt)} />
                          {RESOLUTION_LABELS[opt]}
                        </label>
                      ))}
                    </div>
                    {resolution === "OTHER" && (
                      <textarea
                        placeholder="¿Qué se hizo?"
                        className="w-full rounded border border-rule bg-surface px-2.5 py-2 text-[12px] mb-2 resize-none"
                        rows={2}
                        value={resolutionNote}
                        onChange={(e) => setResolutionNote(e.target.value)}
                      />
                    )}
                    {resolveErr && <div className="text-red text-[11px] mb-1.5">{resolveErr}</div>}
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={resolveSaving || !resolution || (resolution === "OTHER" && !resolutionNote.trim())}
                        className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-50"
                        onClick={() => submitResolve(r.id)}
                      >
                        {resolveSaving ? "Guardando…" : "Confirmar"}
                      </button>
                      <button type="button" className="text-[11px] text-steel cursor-pointer" onClick={resetResolve}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="rounded border border-teal px-3 py-1.5 text-[12px] font-semibold text-teal cursor-pointer"
                    onClick={() => setResolvingId(r.id)}
                  >
                    Marcar resuelto
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}

      <div className="font-display font-bold text-[14px] mb-2.5">Resueltos ({resolved.length})</div>
      {resolved.length === 0 ? (
        <div className="text-steel text-[13px]">Nada resuelto todavía.</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {resolved.map((r) => (
            <div key={r.id} className="bg-cloud border border-rule rounded-md p-3.5 opacity-80">
              <div className="text-[13px] font-semibold flex items-center gap-1.5 flex-wrap mb-1">
                <CatalogCode code={r.catalogItem.justCode} />
                <span className="truncate">{r.catalogItem.name}</span>
              </div>
              <div className="text-[12px] text-steel mb-1">{r.instructionNote}</div>
              <div className="text-[11.5px] text-teal font-semibold">
                {RESOLUTION_LABELS[r.resolution ?? "OTHER"]}
                {r.resolutionNote ? ` — ${r.resolutionNote}` : ""}
              </div>
              <div className="text-[11px] text-steel">
                {r.resolvedBy?.name ?? "—"} · {r.resolvedAt ? formatDateTime(r.resolvedAt) : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
