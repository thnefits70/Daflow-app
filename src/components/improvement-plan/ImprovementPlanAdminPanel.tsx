"use client";

import { useEffect, useState } from "react";
import { ImprovementPlanDetail } from "./ImprovementPlanDetail";
import type { ImprovementPlanSummaryDTO } from "@/lib/improvementPlan";

const STAGE_LABEL: Record<string, string> = {
  PRIMER_PERIODO: "Primer período",
  EXTENDIDO: "Extendido",
  ETAPA_FINAL: "Etapa Final",
  CERRADO: "Cerrado",
};

const SEMAFORO_META: Record<string, { label: string; color: string }> = {
  VERDE: { label: "Verde", color: "#22A67E" },
  AMARILLO: { label: "Amarillo", color: "#D9A441" },
  NARANJA: { label: "Naranja", color: "#D97A3F" },
  ROJO: { label: "Rojo", color: "#E0574A" },
};

const OUTCOME_LABEL: Record<string, string> = {
  CONTINUIDAD: "Continuidad",
  REUBICACION: "Reubicación",
  REVISION_CONTINUIDAD: "Revisión de continuidad",
};

function dateOnly(value: string) {
  return new Date(value).toLocaleDateString("es-MX");
}

export function ImprovementPlanAdminPanel() {
  const [plans, setPlans] = useState<ImprovementPlanSummaryDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch("/api/improvement-plans");
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "No se pudo cargar el panel.");
      return;
    }
    setError(null);
    setPlans(data);
  };

  useEffect(() => {
    load();
  }, []);

  if (selectedPlanId) {
    return (
      <ImprovementPlanDetail
        planId={selectedPlanId}
        isAdmin
        onBack={() => {
          setSelectedPlanId(null);
          load();
        }}
        onChanged={load}
      />
    );
  }

  const pending = plans?.filter((p) => p.hasPendingClosureApproval) ?? [];
  const rest = plans?.filter((p) => !p.hasPendingClosureApproval) ?? [];

  return (
    <div>
      {error && <div className="text-[13px] text-red mb-3">{error}</div>}
      {!plans && !error && <div className="text-[13px] text-steel">Cargando…</div>}

      {pending.length > 0 && (
        <div className="mb-7">
          <h3 className="text-[14px] font-semibold mb-2.5">Cierres pendientes de tu aprobación</h3>
          <div className="space-y-2">
            {pending.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedPlanId(p.id)}
                className="w-full text-left border border-amber/50 bg-amber/10 rounded-md p-3.5 cursor-pointer hover:border-amber"
              >
                <div className="text-[13px] font-semibold">{p.collaboratorName} · {p.deptName}</div>
                <div className="text-[12px] text-steel mt-0.5">
                  Se pidió cerrar como <strong>{p.pendingClosureOutcome ? OUTCOME_LABEL[p.pendingClosureOutcome] : "—"}</strong>
                  {p.leaderName ? ` · solicitado por ${p.leaderName}` : ""}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <h3 className="text-[14px] font-semibold mb-2.5">Todos los planes</h3>
      {plans && rest.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          No hay Planes de Mejora registrados todavía.
        </div>
      )}
      {rest.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left border-b border-rule">
                <th className="py-2 pr-3 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Colaborador</th>
                <th className="py-2 pr-3 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Área</th>
                <th className="py-2 pr-3 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Líder</th>
                <th className="py-2 pr-3 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Etapa</th>
                <th className="py-2 pr-3 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Semáforo</th>
                <th className="py-2 pr-3 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Resultado</th>
                <th className="py-2 text-[10.5px] font-semibold uppercase tracking-wide text-steel" />
              </tr>
            </thead>
            <tbody>
              {rest.map((p) => (
                <tr key={p.id} className="border-b border-rule">
                  <td className="py-2.5 pr-3 text-[13px] font-semibold whitespace-nowrap">{p.collaboratorName}</td>
                  <td className="py-2.5 pr-3 text-[12.5px] text-steel whitespace-nowrap">{p.deptName}</td>
                  <td className="py-2.5 pr-3 text-[12.5px] text-steel whitespace-nowrap">{p.leaderName ?? "—"}</td>
                  <td className="py-2.5 pr-3 text-[12.5px] whitespace-nowrap">{STAGE_LABEL[p.stage]}</td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    {p.latestSemaforo ? (
                      <span className="font-mono text-[10.5px] font-semibold" style={{ color: SEMAFORO_META[p.latestSemaforo].color }}>
                        {SEMAFORO_META[p.latestSemaforo].label}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-[12.5px] text-steel whitespace-nowrap">
                    {p.outcome ? `${OUTCOME_LABEL[p.outcome]} (${p.closedAt ? dateOnly(p.closedAt) : ""})` : "—"}
                  </td>
                  <td className="py-2.5 whitespace-nowrap">
                    <button type="button" onClick={() => setSelectedPlanId(p.id)} className="text-[12px] font-semibold text-blue cursor-pointer">
                      Ver detalle
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
