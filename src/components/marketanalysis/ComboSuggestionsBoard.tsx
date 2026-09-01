"use client";

import { useEffect, useState, useCallback } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";

type CatalogRef = { id: string; name: string; photos: string[]; nicho: string | null };
type Suggestion = {
  id: string;
  nicho: string;
  status: "SUGERIDO" | "SELECCIONADO" | "PENDIENTE_APROBACION" | "APROBADO" | "RECHAZADO" | "CREADO_EN_DROPI";
  batchId: string | null;
  rejectReason: string | null;
  winnerCatalogItem: CatalogRef;
  lowRotationCatalogItem: CatalogRef;
  selectedBy: { name: string } | null;
  reviewedBy: { name: string } | null;
  createdInDropiBy: { name: string } | null;
};

function Pair({ s }: { s: Suggestion }) {
  return (
    <div className="text-[12.5px]">
      <span className="font-semibold text-teal">{s.winnerCatalogItem.name}</span>
      <span className="text-steel"> + </span>
      <span className="font-semibold text-gold" style={{ color: "#D9A441" }}>
        {s.lowRotationCatalogItem.name}
      </span>
      <span className="text-steel"> · {s.nicho}</span>
    </div>
  );
}

// Confirmado 2026-08-31: el equipo de Análisis de Mercado selecciona y manda
// por lote; el líder de MKT (hoy Bryan) aprueba/rechaza TODO el lote junto;
// una vez aprobado, cualquiera del equipo marca "creado en Dropi" cuando ya
// lo armó allá manualmente (sin precio, eso queda fuera de esto).
export function ComboSuggestionsBoard({ canApprove }: { canApprove: boolean }) {
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rejectingBatch, setRejectingBatch] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/combo-suggestions");
    const data = await res.json().catch(() => null);
    if (res.ok) setSuggestions(data.suggestions);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const suggested = (suggestions ?? []).filter((s) => s.status === "SUGERIDO" || s.status === "SELECCIONADO");
  const pendingApproval = (suggestions ?? []).filter((s) => s.status === "PENDIENTE_APROBACION");
  const approved = (suggestions ?? []).filter((s) => s.status === "APROBADO");
  const created = (suggestions ?? []).filter((s) => s.status === "CREADO_EN_DROPI");

  const pendingByBatch = new Map<string, Suggestion[]>();
  for (const s of pendingApproval) {
    const key = s.batchId ?? "";
    pendingByBatch.set(key, [...(pendingByBatch.get(key) ?? []), s]);
  }

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submitBatch() {
    if (checked.size === 0) return;
    setBusy(true);
    setErr("");
    const res = await fetch("/api/combo-suggestions/submit-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...checked] }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo enviar.");
      return;
    }
    setChecked(new Set());
    load();
  }

  async function review(batchId: string, action: "approve" | "reject") {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/combo-suggestions/batch/${batchId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, rejectReason: action === "reject" ? rejectReason.trim() || undefined : undefined }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo revisar el lote.");
      return;
    }
    setRejectingBatch(null);
    setRejectReason("");
    load();
  }

  async function markCreated(id: string) {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/combo-suggestions/${id}/mark-created`, { method: "POST" });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo marcar.");
      return;
    }
    load();
  }

  if (suggestions === null) return <div className="text-[12.5px] text-steel">Cargando…</div>;

  return (
    <div className="flex flex-col gap-5">
      {err && <div className="text-red text-[12.5px]">{err}</div>}

      {canApprove && pendingByBatch.size > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Pendientes de tu aprobación</div>
          <div className="flex flex-col gap-2.5">
            {[...pendingByBatch.entries()].map(([batchId, rows]) => (
              <div key={batchId} className="bg-surface border border-gold/40 rounded-md p-3.5">
                <div className="flex flex-col gap-1.5 mb-2.5">
                  {rows.map((s) => (
                    <Pair key={s.id} s={s} />
                  ))}
                </div>
                {rejectingBatch === batchId ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="text"
                      placeholder="Motivo del rechazo (opcional)"
                      className="rounded border border-rule px-2.5 py-1.5 text-[12px] flex-1 min-w-[200px]"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                    <button type="button" disabled={busy} className="rounded border border-red bg-red px-3 py-1.5 text-[12px] font-bold text-white cursor-pointer" onClick={() => review(batchId, "reject")}>
                      Confirmar rechazo
                    </button>
                    <button type="button" className="text-[11px] text-steel cursor-pointer" onClick={() => setRejectingBatch(null)}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button type="button" disabled={busy} className="rounded border border-teal bg-teal px-3.5 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={() => review(batchId, "approve")}>
                      Aprobar lote
                    </button>
                    <button type="button" disabled={busy} className="rounded border border-rule px-3.5 py-1.5 text-[12px] font-semibold cursor-pointer" onClick={() => setRejectingBatch(batchId)}>
                      Rechazar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {approved.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Aprobados — listos para crear en Dropi</div>
          <div className="flex flex-col gap-2">
            {approved.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 border border-rule rounded p-2.5 flex-wrap">
                <Pair s={s} />
                <button type="button" disabled={busy} className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={() => markCreated(s.id)}>
                  <ExternalLink size={12} className="inline mr-1" /> Ya lo creé en Dropi
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Sugerencias nuevas</div>
        {suggested.length === 0 ? (
          <div className="border-[1.5px] border-dashed border-rule rounded-md p-6 text-center text-steel text-[12.5px]">
            No hay sugerencias nuevas todavía.
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5 mb-2.5">
              {suggested.map((s) => (
                <label key={s.id} className="flex items-center gap-2.5 border border-rule rounded p-2.5 cursor-pointer">
                  <input type="checkbox" checked={checked.has(s.id)} onChange={() => toggle(s.id)} />
                  <Pair s={s} />
                </label>
              ))}
            </div>
            <button
              type="button"
              disabled={busy || checked.size === 0}
              className="rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60"
              onClick={submitBatch}
            >
              Enviar {checked.size > 0 ? `(${checked.size}) ` : ""}a aprobación
            </button>
          </>
        )}
      </div>

      {created.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Ya creados en Dropi</div>
          <div className="flex flex-col gap-1.5">
            {created.map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-[12px] text-steel">
                <CheckCircle2 size={13} className="text-teal shrink-0" />
                <Pair s={s} />
                {s.createdInDropiBy && <span>· {s.createdInDropiBy.name}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
