"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Sparkles } from "lucide-react";
import { formatDateTime } from "@/lib/formatDateTime";
import { SUGGESTED_INDICATORS } from "@/lib/improvementPlanConstants";
import type { ImprovementPlanDetailDTO } from "@/lib/improvementPlan";

type Semaforo = "VERDE" | "AMARILLO" | "NARANJA" | "ROJO";
type Stage = "PRIMER_PERIODO" | "EXTENDIDO" | "ETAPA_FINAL" | "CERRADO";
type Outcome = "CONTINUIDAD" | "REUBICACION" | "REVISION_CONTINUIDAD";

const SEMAFORO_META: Record<Semaforo, { label: string; color: string }> = {
  VERDE: { label: "Verde", color: "#22A67E" },
  AMARILLO: { label: "Amarillo", color: "#D9A441" },
  NARANJA: { label: "Naranja", color: "#D97A3F" },
  ROJO: { label: "Rojo", color: "#E0574A" },
};

const STAGE_LABEL: Record<Stage, string> = {
  PRIMER_PERIODO: "Primer período",
  EXTENDIDO: "Extendido",
  ETAPA_FINAL: "Etapa Final",
  CERRADO: "Cerrado",
};

const OUTCOME_LABEL: Record<Outcome, string> = {
  CONTINUIDAD: "Continuidad",
  REUBICACION: "Reubicación",
  REVISION_CONTINUIDAD: "Revisión de continuidad",
};

function dateOnly(value: string) {
  return new Date(value).toLocaleDateString("es-MX");
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="font-mono text-[10.5px] font-semibold px-2.5 py-1 rounded-full"
      style={{ color, border: `1px solid ${color}`, background: `${color}1a` }}
    >
      {label}
    </span>
  );
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

type ReviewDraft = { scores: Record<string, number>; queMejoro: string; queFalta: string; accionSiguiente: string; apoyoLider: string };

export function ImprovementPlanDetail({
  planId,
  isAdmin = false,
  onBack,
  onChanged,
}: {
  planId: string;
  isAdmin?: boolean;
  onBack?: () => void;
  onChanged?: () => void;
}) {
  const [plan, setPlan] = useState<ImprovementPlanDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/improvement-plans/${planId}`);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "No se pudo cargar el plan.");
      setLoading(false);
      return;
    }
    setPlan(data);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  const refresh = async () => {
    await load();
    onChanged?.();
  };

  if (loading) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (error || !plan) return <div className="text-[13px] text-red">{error ?? "No se pudo cargar el plan."}</div>;

  const isClosed = plan.stage === "CERRADO";

  return (
    <div>
      {onBack && (
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-[12.5px] text-steel hover:text-ink mb-4 cursor-pointer">
          <ArrowLeft size={14} /> Volver al equipo
        </button>
      )}

      <div className="flex flex-wrap items-center gap-2.5 mb-1">
        <h2 className="font-display text-[19px] font-bold">{plan.collaboratorName}</h2>
        <Chip label={STAGE_LABEL[plan.stage]} color={isClosed ? "#92A3C0" : "#1E5EFF"} />
        {plan.latestSemaforo && <Chip label={`Semáforo: ${SEMAFORO_META[plan.latestSemaforo].label}`} color={SEMAFORO_META[plan.latestSemaforo].color} />}
        {isClosed && plan.outcome && <Chip label={`Resultado: ${OUTCOME_LABEL[plan.outcome]}`} color="#92A3C0" />}
      </div>
      <div className="text-[12px] text-steel mb-5">
        {plan.deptName} · {isClosed ? `Cerrado el ${plan.closedAt ? dateOnly(plan.closedAt) : "—"}` : `Vence esta etapa el ${dateOnly(plan.stageDeadline)}`}
        {plan.leaderName && ` · Líder: ${plan.leaderName}`}
      </div>

      {plan.hasPendingClosureApproval && (
        <div className="border border-amber/50 bg-amber/10 rounded-md p-3.5 mb-5 text-[12.5px]">
          <div className="font-semibold text-amber mb-1">Cierre pendiente de aprobación del admin</div>
          <div className="text-steel">
            Se solicitó cerrar como <strong>{plan.pendingClosureOutcome ? OUTCOME_LABEL[plan.pendingClosureOutcome] : "—"}</strong>
            {plan.pendingClosureNotes ? `: "${plan.pendingClosureNotes}"` : ""}
          </div>
          {isAdmin && <ApproveClosureBox planId={plan.id} onDone={refresh} />}
        </div>
      )}

      {!isClosed && plan.pendingClosureRejectedAt && (
        <div className="border border-red/40 bg-red/10 rounded-md p-3.5 mb-5 text-[12.5px] text-red">
          El admin rechazó el último cierre solicitado el {dateOnly(plan.pendingClosureRejectedAt)} — el plan sigue abierto.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-surface border border-rule rounded-lg p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-1.5">Situación</div>
          <div className="text-[13px] text-ink/90 whitespace-pre-wrap">{plan.situacion}</div>
        </div>
        <div className="bg-surface border border-rule rounded-lg p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-1.5">Resultado esperado</div>
          <div className="text-[13px] text-ink/90 whitespace-pre-wrap">{plan.resultadoEsperado}</div>
        </div>
      </div>

      <div className="mb-6">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Compromisos</div>
        <div className="space-y-2">
          {plan.commitments.map((c) => (
            <div key={c.id} className="border border-rule rounded-md p-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-semibold">{c.indicador}</div>
                <div className="text-[12px] text-steel">{c.meta}</div>
              </div>
              <span className="font-mono text-[10px] font-semibold text-steel shrink-0">{c.responsable === "LIDER" ? "Líder" : "Colaborador"}</span>
            </div>
          ))}
        </div>
      </div>

      {!isClosed && (
        <WeeklyReviewForm planId={plan.id} onSaved={refresh} />
      )}

      {!isClosed && (
        <StageActions plan={plan} onChanged={refresh} />
      )}

      <div className="mt-7">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Historial de evaluaciones</div>
        {plan.reviews.length === 0 && <div className="text-[12.5px] text-steel">Todavía no hay evaluaciones semanales.</div>}
        <div className="space-y-3">
          {plan.reviews.map((r) => (
            <div key={r.id} className="border border-rule rounded-md p-3.5">
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <span className="text-[12px] font-semibold">Semana del {dateOnly(r.weekOf)}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-steel">Promedio {r.avgScore.toFixed(1)}</span>
                  <Chip label={SEMAFORO_META[r.semaforo].label} color={SEMAFORO_META[r.semaforo].color} />
                  {r.aiAssisted && <span title="Generado con IA" className="text-teal"><Sparkles size={13} /></span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {Object.entries(r.scores).map(([k, v]) => (
                  <span key={k} className="font-mono text-[10px] text-steel border border-rule rounded-full px-2 py-0.5">
                    {k}: {v}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[12px]">
                <div><span className="text-steel">Qué mejoró: </span>{r.queMejoro}</div>
                <div><span className="text-steel">Qué falta: </span>{r.queFalta}</div>
                <div><span className="text-steel">Acción siguiente: </span>{r.accionSiguiente}</div>
                <div><span className="text-steel">Apoyo del líder: </span>{r.apoyoLider}</div>
              </div>
              <div className="text-[10.5px] text-steel mt-2">{formatDateTime(r.createdAt)}{r.createdByName ? ` · ${r.createdByName}` : ""}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ApproveClosureBox({ planId, onDone }: { planId: string; onDone: () => void }) {
  const [rejectionNote, setRejectionNote] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/improvement-plans/${planId}/approve-closure`, { approve, rejectionNote });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo procesar.");
    }
    setBusy(false);
  };

  return (
    <div className="mt-3 pt-3 border-t border-amber/30">
      {error && <div className="text-[12px] text-red mb-2">{error}</div>}
      {!showReject ? (
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => act(true)} className="text-[12px] font-semibold text-white bg-green px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-50">
            Aprobar cierre
          </button>
          <button type="button" disabled={busy} onClick={() => setShowReject(true)} className="text-[12px] font-semibold text-red border border-red px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-50">
            Rechazar
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <textarea
            value={rejectionNote}
            onChange={(e) => setRejectionNote(e.target.value)}
            placeholder="Motivo del rechazo (opcional)"
            className="bg-cloud border border-rule rounded-md p-2 text-[12.5px] text-ink"
            rows={2}
          />
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => act(false)} className="text-[12px] font-semibold text-white bg-red px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-50">
              Confirmar rechazo
            </button>
            <button type="button" onClick={() => setShowReject(false)} className="text-[12px] text-steel cursor-pointer">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WeeklyReviewForm({ planId, onSaved }: { planId: string; onSaved: () => void }) {
  const [freeText, setFreeText] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});
  const [queMejoro, setQueMejoro] = useState("");
  const [queFalta, setQueFalta] = useState("");
  const [accionSiguiente, setAccionSiguiente] = useState("");
  const [apoyoLider, setApoyoLider] = useState("");
  const [aiUsed, setAiUsed] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const generateDraft = async () => {
    if (!freeText.trim()) return;
    setAiBusy(true);
    setError(null);
    try {
      const draft = (await postJson(`/api/improvement-plans/${planId}/ai-draft-review`, { freeText })) as ReviewDraft;
      setScores(draft.scores);
      setQueMejoro(draft.queMejoro);
      setQueFalta(draft.queFalta);
      setAccionSiguiente(draft.accionSiguiente);
      setApoyoLider(draft.apoyoLider);
      setAiUsed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el borrador.");
    }
    setAiBusy(false);
  };

  const toggleIndicator = (indicador: string) => {
    setScores((prev) => {
      const next = { ...prev };
      if (indicador in next) delete next[indicador];
      else next[indicador] = 3;
      return next;
    });
  };

  const setScore = (indicador: string, value: number) => {
    setScores((prev) => ({ ...prev, [indicador]: value }));
  };

  const reset = () => {
    setFreeText("");
    setScores({});
    setQueMejoro("");
    setQueFalta("");
    setAccionSiguiente("");
    setApoyoLider("");
    setAiUsed(false);
    setOpen(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await postJson(`/api/improvement-plans/${planId}/reviews`, {
        weekOf: new Date().toISOString(),
        scores,
        queMejoro,
        queFalta,
        accionSiguiente,
        apoyoLider,
        aiAssisted: aiUsed,
      });
      reset();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la evaluación.");
    }
    setSaving(false);
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[12.5px] font-semibold text-blue mb-6 cursor-pointer">
        + Registrar evaluación semanal
      </button>
    );
  }

  const canSave = Object.keys(scores).length > 0 && queMejoro.trim() && queFalta.trim() && accionSiguiente.trim() && apoyoLider.trim();

  return (
    <div className="bg-surface border border-rule rounded-lg p-4 mb-6">
      <div className="text-[13px] font-semibold mb-2.5">Evaluación semanal</div>
      {error && <div className="text-[12px] text-red mb-2">{error}</div>}

      <textarea
        value={freeText}
        onChange={(e) => setFreeText(e.target.value)}
        placeholder="Cuenta libremente cómo fue la semana de este colaborador…"
        className="w-full bg-cloud border border-rule rounded-md p-2.5 text-[13px] text-ink mb-2"
        rows={3}
      />
      <button
        type="button"
        disabled={aiBusy || !freeText.trim()}
        onClick={generateDraft}
        className="flex items-center gap-1.5 text-[12px] font-semibold text-teal mb-4 cursor-pointer disabled:opacity-50"
      >
        <Sparkles size={13} /> {aiBusy ? "Generando…" : "Generar borrador con IA"}
      </button>

      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-1.5">Calificaciones (1-5)</div>
      <div className="space-y-1.5 mb-4">
        {SUGGESTED_INDICATORS.map((ind) => (
          <div key={ind} className="flex items-center gap-2.5">
            <input type="checkbox" checked={ind in scores} onChange={() => toggleIndicator(ind)} className="cursor-pointer" />
            <span className="text-[12.5px] flex-1">{ind}</span>
            {ind in scores && (
              <select value={scores[ind]} onChange={(e) => setScore(ind, Number(e.target.value))} className="bg-cloud border border-rule rounded px-1.5 py-0.5 text-[12px]">
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-4">
        <textarea value={queMejoro} onChange={(e) => setQueMejoro(e.target.value)} placeholder="Qué mejoró esta semana" className="bg-cloud border border-rule rounded-md p-2 text-[12.5px] text-ink" rows={2} />
        <textarea value={queFalta} onChange={(e) => setQueFalta(e.target.value)} placeholder="Qué sigue faltando" className="bg-cloud border border-rule rounded-md p-2 text-[12.5px] text-ink" rows={2} />
        <textarea value={accionSiguiente} onChange={(e) => setAccionSiguiente(e.target.value)} placeholder="Acción para la próxima semana" className="bg-cloud border border-rule rounded-md p-2 text-[12.5px] text-ink" rows={2} />
        <textarea value={apoyoLider} onChange={(e) => setApoyoLider(e.target.value)} placeholder="Apoyo que dará el líder" className="bg-cloud border border-rule rounded-md p-2 text-[12.5px] text-ink" rows={2} />
      </div>

      <div className="flex gap-2">
        <button type="button" disabled={saving || !canSave} onClick={save} className="text-[12.5px] font-semibold text-white bg-blue px-3.5 py-1.5 rounded-md cursor-pointer disabled:opacity-50">
          {saving ? "Guardando…" : "Guardar evaluación"}
        </button>
        <button type="button" onClick={reset} className="text-[12.5px] text-steel cursor-pointer">
          Cancelar
        </button>
      </div>
    </div>
  );
}

function StageActions({ plan, onChanged }: { plan: ImprovementPlanDetailDTO; onChanged: () => void }) {
  const [duration, setDuration] = useState(plan.stageDurationDays);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClosure, setShowClosure] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("CONTINUIDAD");
  const [notes, setNotes] = useState("");

  const decide = async (decision: "SATISFACTORIO" | "INSUFICIENTE" | "SIN_MEJORA") => {
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/improvement-plans/${plan.id}/decide-stage`, { decision, newStageDurationDays: duration });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar la decisión.");
    }
    setBusy(false);
  };

  const requestClosure = async () => {
    if (!notes.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/improvement-plans/${plan.id}/request-closure`, { outcome, notes });
      setShowClosure(false);
      setNotes("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo procesar el cierre.");
    }
    setBusy(false);
  };

  const canAdvanceStage = plan.stage !== "ETAPA_FINAL";

  return (
    <div className="bg-surface border border-rule rounded-lg p-4 mb-6">
      <div className="text-[13px] font-semibold mb-2.5">Decisión de etapa</div>
      {error && <div className="text-[12px] text-red mb-2">{error}</div>}

      {canAdvanceStage && (
        <div className="mb-4">
          <div className="text-[12px] text-steel mb-2">
            Al llegar al plazo (o antes, si ya está claro), registra cómo quedó {STAGE_LABEL[plan.stage]}:
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <button type="button" disabled={busy} onClick={() => decide("SATISFACTORIO")} className="text-[12px] font-semibold text-white bg-green px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-50">
              Satisfactorio — cerrar como Continuidad
            </button>
            <button type="button" disabled={busy} onClick={() => decide("INSUFICIENTE")} className="text-[12px] font-semibold text-navy bg-amber px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-50">
              {plan.stage === "PRIMER_PERIODO" ? "Mejora pero insuficiente — pasar a Extendido" : "Insuficiente — pasar a Etapa Final"}
            </button>
            <button type="button" disabled={busy} onClick={() => decide("SIN_MEJORA")} className="text-[12px] font-semibold text-white bg-orange px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-50">
              Sin mejora — pasar a Etapa Final
            </button>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-steel">
            Duración de la siguiente etapa (días):
            <input type="number" min={1} max={120} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-16 bg-cloud border border-rule rounded px-1.5 py-0.5 text-[12px]" />
          </label>
        </div>
      )}

      {!showClosure ? (
        <button type="button" onClick={() => setShowClosure(true)} className="text-[12.5px] font-semibold text-blue cursor-pointer">
          Solicitar cierre del plan
        </button>
      ) : (
        <div className="mt-2 pt-3 border-t border-rule">
          <div className="text-[12px] text-steel mb-2">
            Continuidad se aplica de inmediato; Reubicación y Revisión de continuidad quedan pendientes de aprobación del admin.
          </div>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)} className="bg-cloud border border-rule rounded-md px-2 py-1.5 text-[12.5px] mb-2 w-full sm:w-auto">
            <option value="CONTINUIDAD">Continuidad</option>
            <option value="REUBICACION">Reubicación</option>
            <option value="REVISION_CONTINUIDAD">Revisión de continuidad</option>
          </select>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Nota de cierre" className="w-full bg-cloud border border-rule rounded-md p-2 text-[12.5px] text-ink mb-2" rows={2} />
          <div className="flex gap-2">
            <button type="button" disabled={busy || !notes.trim()} onClick={requestClosure} className="text-[12.5px] font-semibold text-white bg-blue px-3.5 py-1.5 rounded-md cursor-pointer disabled:opacity-50">
              Confirmar
            </button>
            <button type="button" onClick={() => setShowClosure(false)} className="text-[12.5px] text-steel cursor-pointer">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
