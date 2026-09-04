"use client";

import { useEffect, useState, useCallback } from "react";
import { CheckCircle2, ExternalLink, TrendingUp, TrendingDown } from "lucide-react";

type CatalogRef = { id: string; name: string; photos: string[]; nicho: string | null };
type Suggestion = {
  id: string;
  nicho: string;
  matchScore: number | null;
  status: "SUGERIDO" | "SELECCIONADO" | "PENDIENTE_APROBACION" | "APROBADO" | "RECHAZADO" | "CREADO_EN_DROPI";
  batchId: string | null;
  rejectReason: string | null;
  winnerCatalogItem: CatalogRef;
  lowRotationCatalogItem: CatalogRef;
  selectedBy: { name: string } | null;
  reviewedBy: { name: string } | null;
  createdInDropiBy: { name: string } | null;
};

// Confirmado 2026-09-03: pedido explícito del usuario — qué tan probable es,
// según la IA, que esta combinación específica funcione bien como combo.
function MatchScoreBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const color = score >= 80 ? "#3FB98C" : score >= 60 ? "#D9A441" : "#C4665A";
  return (
    <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5" style={{ color, border: `1px solid ${color}` }}>
      {score}% probable
    </span>
  );
}

// Confirmado 2026-09-03: pedido explícito del usuario — antes solo el color
// distinguía cuál de los dos productos es el que ya vende bien (ganador) y
// cuál es el que casi no se vende (baja rotación, el que el combo busca
// mover) — poco claro sin saber de memoria la convención. Ahora cada uno
// lleva un ícono + palabra fija, además del color.
function Pair({ s }: { s: Suggestion }) {
  return (
    <div className="text-[12.5px] flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 font-semibold text-teal">
        <TrendingUp size={12} /> {s.winnerCatalogItem.name}
        <span className="text-[10px] font-normal text-steel">(vende bien)</span>
      </span>
      <span className="text-steel">+</span>
      <span className="inline-flex items-center gap-1 font-semibold" style={{ color: "#D9A441" }}>
        <TrendingDown size={12} /> {s.lowRotationCatalogItem.name}
        <span className="text-[10px] font-normal text-steel">(casi no se vende)</span>
      </span>
      <span className="text-steel">· {s.nicho}</span>
      <MatchScoreBadge score={s.matchScore} />
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
  const [recalculating, setRecalculating] = useState(false);
  const [recalcMsg, setRecalcMsg] = useState("");
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/combo-suggestions");
    const data = await res.json().catch(() => null);
    if (res.ok) setSuggestions(data.suggestions);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const suggested = (suggestions ?? [])
    .filter((s) => s.status === "SUGERIDO" || s.status === "SELECCIONADO")
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
  const pendingApproval = (suggestions ?? []).filter((s) => s.status === "PENDIENTE_APROBACION");
  const approved = (suggestions ?? []).filter((s) => s.status === "APROBADO");
  const created = (suggestions ?? []).filter((s) => s.status === "CREADO_EN_DROPI");

  const pendingByBatch = new Map<string, Suggestion[]>();
  for (const s of pendingApproval) {
    const key = s.batchId ?? "";
    pendingByBatch.set(key, [...(pendingByBatch.get(key) ?? []), s]);
  }

  // Pedido del usuario (2026-09-04): marcar de un click todas las de un
  // mismo color de probabilidad (verde ≥80%, naranja 60-79%), en vez de
  // clickear casilla por casilla cuando hay decenas de sugerencias.
  function selectByTier(min: number, max: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const s of suggested) {
        const score = s.matchScore ?? 0;
        if (score >= min && score <= max) next.add(s.id);
      }
      return next;
    });
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

  // Confirmado 2026-09-03: el cruce automático contra el Excel semanal de
  // stock (ver comboSuggestions.ts) puede tener datos nuevos con qué cruzar
  // sin que nadie guarde una lectura de ATOM ni baja rotación manual — este
  // botón recalcula en el momento en vez de esperar a que pase alguna de
  // esas dos acciones.
  async function recalculate() {
    setRecalculating(true);
    setRecalcMsg("");
    setErr("");
    const res = await fetch("/api/combo-suggestions/recalculate", { method: "POST" });
    const data = await res.json().catch(() => null);
    setRecalculating(false);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo recalcular.");
      return;
    }
    setRecalcMsg(data.created > 0 ? `${data.created} sugerencia${data.created === 1 ? "" : "s"} nueva${data.created === 1 ? "" : "s"}.` : "Sin novedades por ahora.");
    load();
  }

  // Confirmado 2026-09-03: para limpiar las sugerencias creadas ANTES del
  // filtro de IA (puro cruce por nicho, sin revisar sentido real) — no se
  // vuelven a evaluar solas porque el cruce nunca re-procesa una pareja que
  // ya existe como ComboSuggestion.
  async function discardUnreviewed() {
    setDiscarding(true);
    setErr("");
    const res = await fetch("/api/combo-suggestions/discard-unreviewed", { method: "POST" });
    const data = await res.json().catch(() => null);
    setDiscarding(false);
    setConfirmingDiscard(false);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo descartar.");
      return;
    }
    setRecalcMsg(`${data.deleted} descartada${data.deleted === 1 ? "" : "s"}.`);
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
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel">Sugerencias nuevas</div>
          <div className="flex items-center gap-2">
            {recalcMsg && <span className="text-[11px] text-steel">{recalcMsg}</span>}
            {canApprove && suggested.length > 0 && (
              confirmingDiscard ? (
                <span className="flex items-center gap-1.5 text-[11px]">
                  ¿Descartar las {suggested.length} sin revisar?
                  <button type="button" disabled={discarding} className="font-bold text-red cursor-pointer disabled:opacity-60" onClick={discardUnreviewed}>
                    {discarding ? "Descartando…" : "Sí"}
                  </button>
                  <button type="button" className="text-steel cursor-pointer" onClick={() => setConfirmingDiscard(false)}>
                    No
                  </button>
                </span>
              ) : (
                <button type="button" className="rounded border border-rule px-2.5 py-1 text-[11px] font-semibold cursor-pointer" onClick={() => setConfirmingDiscard(true)}>
                  Descartar sin revisar
                </button>
              )
            )}
            {recalculating && <span className="text-[11px] text-steel">Puede tardar hasta 1 minuto…</span>}
            <button type="button" disabled={recalculating} className="rounded border border-rule px-2.5 py-1 text-[11px] font-semibold cursor-pointer disabled:opacity-60" onClick={recalculate}>
              {recalculating ? "Recalculando…" : "Recalcular sugerencias"}
            </button>
          </div>
        </div>
        {suggested.length === 0 ? (
          <div className="border-[1.5px] border-dashed border-rule rounded-md p-6 text-center text-steel text-[12.5px]">
            No hay sugerencias nuevas todavía.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2 text-[11px]">
              <span className="text-steel">Marcar de una:</span>
              <button
                type="button"
                className="rounded-full px-2 py-0.5 font-semibold cursor-pointer"
                style={{ color: "#3FB98C", border: "1px solid #3FB98C" }}
                onClick={() => selectByTier(80, 100)}
              >
                Verdes (≥80%)
              </button>
              <button
                type="button"
                className="rounded-full px-2 py-0.5 font-semibold cursor-pointer"
                style={{ color: "#D9A441", border: "1px solid #D9A441" }}
                onClick={() => selectByTier(60, 79)}
              >
                Naranjas (60-79%)
              </button>
              <button
                type="button"
                className="rounded-full px-2 py-0.5 font-semibold cursor-pointer"
                style={{ color: "#C4665A", border: "1px solid #C4665A" }}
                onClick={() => selectByTier(0, 59)}
              >
                Rojas (&lt;60%)
              </button>
              {checked.size > 0 && (
                <button type="button" className="text-steel underline cursor-pointer" onClick={() => setChecked(new Set())}>
                  Limpiar selección
                </button>
              )}
            </div>
            <div className="flex flex-col gap-1.5 mb-2.5">
              {suggested.map((s) => (
                <div key={s.id} className="flex items-center gap-2.5 border border-rule rounded p-2.5">
                  <input type="checkbox" className="cursor-pointer" checked={checked.has(s.id)} onChange={() => toggle(s.id)} />
                  <Pair s={s} />
                </div>
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
