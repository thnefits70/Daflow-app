"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { ImprovementPlanDetail } from "./ImprovementPlanDetail";
import type { ImprovementPlanRosterEntryDTO } from "@/lib/improvementPlan";

type Semaforo = "VERDE" | "AMARILLO" | "NARANJA" | "ROJO";
type Responsable = "COLABORADOR" | "LIDER";

const SEMAFORO_META: Record<Semaforo, { label: string; color: string }> = {
  VERDE: { label: "Verde", color: "#22A67E" },
  AMARILLO: { label: "Amarillo", color: "#D9A441" },
  NARANJA: { label: "Naranja", color: "#D97A3F" },
  ROJO: { label: "Rojo", color: "#E0574A" },
};

const STAGE_LABEL: Record<string, string> = {
  PRIMER_PERIODO: "Primer período",
  EXTENDIDO: "Extendido",
  ETAPA_FINAL: "Etapa Final",
};

type PlanDraft = {
  situacion: string;
  resultadoEsperado: string;
  commitments: { indicador: string; meta: string; responsable: Responsable }[];
};

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

export function ImprovementPlanTeamPanel({ deptId, isAdmin = false }: { deptId: string; isAdmin?: boolean }) {
  const [roster, setRoster] = useState<ImprovementPlanRosterEntryDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [creatingForUserId, setCreatingForUserId] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch(`/api/improvement-plans/roster?deptId=${deptId}`);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "No se pudo cargar el equipo.");
      return;
    }
    setError(null);
    setRoster(data);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deptId]);

  if (selectedPlanId) {
    return (
      <ImprovementPlanDetail
        planId={selectedPlanId}
        isAdmin={isAdmin}
        onBack={() => {
          setSelectedPlanId(null);
          load();
        }}
        onChanged={load}
      />
    );
  }

  if (creatingForUserId) {
    const entry = roster?.find((r) => r.userId === creatingForUserId);
    return (
      <CreatePlanFlow
        userId={creatingForUserId}
        userName={entry?.userName ?? "Colaborador"}
        onCancel={() => setCreatingForUserId(null)}
        onCreated={(planId) => {
          setCreatingForUserId(null);
          setSelectedPlanId(planId);
        }}
      />
    );
  }

  return (
    <div>
      <h1 className="print:hidden font-display text-[22px] font-bold mb-1">Plan de Mejora y Acompañamiento</h1>
      <p className="print:hidden text-[13px] text-steel mb-5">
        Abre un plan formal de seguimiento para una persona de tu equipo cuando una situación de desempeño se repite.
      </p>

      {error && <div className="text-[13px] text-red mb-3">{error}</div>}
      {!roster && !error && <div className="text-[13px] text-steel">Cargando…</div>}

      {roster && roster.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          No hay colaboradores en este equipo todavía.
        </div>
      )}

      <div className="space-y-2">
        {roster?.map((r) => (
          <div key={r.userId} className="border border-rule rounded-md p-3.5 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[13px] font-semibold">{r.userName}</div>
              {r.activePlan && (
                <div className="text-[11.5px] text-steel mt-0.5">
                  {STAGE_LABEL[r.activePlan.stage] ?? r.activePlan.stage}
                  {r.activePlan.hasPendingClosureApproval && " · cierre pendiente de aprobación"}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              {r.activePlan?.latestSemaforo && (
                <span
                  className="font-mono text-[10.5px] font-semibold px-2.5 py-1 rounded-full"
                  style={{
                    color: SEMAFORO_META[r.activePlan.latestSemaforo].color,
                    border: `1px solid ${SEMAFORO_META[r.activePlan.latestSemaforo].color}`,
                    background: `${SEMAFORO_META[r.activePlan.latestSemaforo].color}1a`,
                  }}
                >
                  {SEMAFORO_META[r.activePlan.latestSemaforo].label}
                </span>
              )}
              {r.activePlan ? (
                <button type="button" onClick={() => setSelectedPlanId(r.activePlan!.id)} className="text-[12px] font-semibold text-blue cursor-pointer">
                  Ver plan
                </button>
              ) : (
                <button type="button" onClick={() => setCreatingForUserId(r.userId)} className="text-[12px] font-semibold text-teal cursor-pointer">
                  Iniciar plan
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreatePlanFlow({
  userId,
  userName,
  onCancel,
  onCreated,
}: {
  userId: string;
  userName: string;
  onCancel: () => void;
  onCreated: (planId: string) => void;
}) {
  const [freeText, setFreeText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<PlanDraft>({ situacion: "", resultadoEsperado: "", commitments: [] });
  const [stageDurationDays, setStageDurationDays] = useState(15);
  const [saving, setSaving] = useState(false);

  const generateDraft = async () => {
    if (!freeText.trim()) return;
    setAiBusy(true);
    setError(null);
    try {
      const result = (await postJson("/api/improvement-plans/ai-draft-plan", { freeText })) as PlanDraft;
      setDraft(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el borrador.");
    }
    setAiBusy(false);
  };

  const addCommitment = () => {
    if (draft.commitments.length >= 3) return;
    setDraft((d) => ({ ...d, commitments: [...d.commitments, { indicador: "", meta: "", responsable: "COLABORADOR" }] }));
  };

  const removeCommitment = (idx: number) => {
    setDraft((d) => ({ ...d, commitments: d.commitments.filter((_, i) => i !== idx) }));
  };

  const updateCommitment = (idx: number, field: "indicador" | "meta" | "responsable", value: string) => {
    setDraft((d) => ({
      ...d,
      commitments: d.commitments.map((c, i) => (i === idx ? { ...c, [field]: value } : c)),
    }));
  };

  const canSave =
    draft.situacion.trim() &&
    draft.resultadoEsperado.trim() &&
    draft.commitments.length > 0 &&
    draft.commitments.every((c) => c.indicador.trim() && c.meta.trim());

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const plan = await postJson("/api/improvement-plans", {
        collaboratorId: userId,
        situacion: draft.situacion,
        resultadoEsperado: draft.resultadoEsperado,
        stageDurationDays,
        commitments: draft.commitments,
      });
      onCreated(plan.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el plan.");
    }
    setSaving(false);
  };

  return (
    <div>
      <button type="button" onClick={onCancel} className="text-[12.5px] text-steel hover:text-ink mb-4 cursor-pointer">
        ← Cancelar
      </button>
      <h2 className="font-display text-[19px] font-bold mb-4">Iniciar Plan de Mejora — {userName}</h2>
      {error && <div className="text-[13px] text-red mb-3">{error}</div>}

      <div className="bg-surface border border-rule rounded-lg p-4 mb-5">
        <div className="text-[12.5px] text-steel mb-2">Describe libremente la situación con tus propias palabras:</div>
        <textarea
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          className="w-full bg-cloud border border-rule rounded-md p-2.5 text-[13px] text-ink mb-2"
          rows={4}
          placeholder="Ej: en las últimas semanas ha llegado tarde varias veces y le ha costado seguir las instrucciones de despacho…"
        />
        <button
          type="button"
          disabled={aiBusy || !freeText.trim()}
          onClick={generateDraft}
          className="flex items-center gap-1.5 text-[12px] font-semibold text-teal cursor-pointer disabled:opacity-50"
        >
          <Sparkles size={13} /> {aiBusy ? "Generando…" : "Generar borrador con IA"}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <label className="text-[12px] text-steel flex flex-col gap-1">
          Situación
          <textarea value={draft.situacion} onChange={(e) => setDraft((d) => ({ ...d, situacion: e.target.value }))} className="bg-cloud border border-rule rounded-md p-2 text-[13px] text-ink" rows={3} />
        </label>
        <label className="text-[12px] text-steel flex flex-col gap-1">
          Resultado esperado
          <textarea value={draft.resultadoEsperado} onChange={(e) => setDraft((d) => ({ ...d, resultadoEsperado: e.target.value }))} className="bg-cloud border border-rule rounded-md p-2 text-[13px] text-ink" rows={3} />
        </label>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[12px] font-semibold text-steel">Compromisos (1 a 3)</div>
          {draft.commitments.length < 3 && (
            <button type="button" onClick={addCommitment} className="text-[12px] font-semibold text-blue cursor-pointer">
              + Agregar
            </button>
          )}
        </div>
        <div className="space-y-2">
          {draft.commitments.map((c, idx) => (
            <div key={idx} className="border border-rule rounded-md p-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                <input value={c.indicador} onChange={(e) => updateCommitment(idx, "indicador", e.target.value)} placeholder="Indicador" className="bg-cloud border border-rule rounded-md p-2 text-[12.5px] text-ink" />
                <input value={c.meta} onChange={(e) => updateCommitment(idx, "meta", e.target.value)} placeholder="Meta" className="bg-cloud border border-rule rounded-md p-2 text-[12.5px] text-ink" />
              </div>
              <div className="flex items-center justify-between">
                <select value={c.responsable} onChange={(e) => updateCommitment(idx, "responsable", e.target.value)} className="bg-cloud border border-rule rounded px-2 py-1 text-[12px]">
                  <option value="COLABORADOR">Responsable: Colaborador</option>
                  <option value="LIDER">Responsable: Líder</option>
                </select>
                <button type="button" onClick={() => removeCommitment(idx)} className="text-[11.5px] text-red cursor-pointer">
                  Quitar
                </button>
              </div>
            </div>
          ))}
          {draft.commitments.length === 0 && <div className="text-[12px] text-steel">Agrega al menos un compromiso.</div>}
        </div>
      </div>

      <label className="flex items-center gap-2 text-[12px] text-steel mb-5">
        Duración de la primera etapa (días):
        <input type="number" min={1} max={120} value={stageDurationDays} onChange={(e) => setStageDurationDays(Number(e.target.value))} className="w-16 bg-cloud border border-rule rounded px-1.5 py-0.5 text-[12px]" />
      </label>

      <button type="button" disabled={!canSave || saving} onClick={save} className="text-[13px] font-semibold text-white bg-blue px-4 py-2 rounded-md cursor-pointer disabled:opacity-50">
        {saving ? "Creando…" : "Crear Plan de Mejora"}
      </button>
    </div>
  );
}
