import { ClipboardList } from "lucide-react";
import type { ImprovementPlanDetailDTO } from "@/lib/improvementPlan";

const SEMAFORO_META: Record<string, { label: string; color: string }> = {
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

function dateOnly(value: string) {
  return new Date(value).toLocaleDateString("es-MX");
}

// Transparencia total del colaborador sobre su propio caso (confirmado
// 2026-09-10): ve compromisos + cada evaluación completa, pero nunca puede
// editar nada ni ve texto generado por IA — esta tarjeta es de solo lectura,
// sin ningún fetch propio (recibe el plan ya resuelto en el servidor).
export function ImprovementPlanCollaboratorCard({ plan }: { plan: ImprovementPlanDetailDTO }) {
  return (
    <div className="bg-surface border border-rule rounded-lg p-5 mb-6">
      <div className="flex items-center gap-2.5 mb-1">
        <span className="w-9 h-9 rounded-full bg-blue/15 text-blue flex items-center justify-center shrink-0">
          <ClipboardList size={17} />
        </span>
        <div>
          <div className="text-[14px] font-semibold">Tu Plan de Mejora y Acompañamiento</div>
          <div className="text-[11.5px] text-steel">
            {STAGE_LABEL[plan.stage] ?? plan.stage} · vence el {dateOnly(plan.stageDeadline)}
            {plan.latestSemaforo && (
              <span className="ml-2 font-mono font-semibold" style={{ color: SEMAFORO_META[plan.latestSemaforo].color }}>
                · {SEMAFORO_META[plan.latestSemaforo].label}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 mb-4">
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-steel mb-1">Situación</div>
          <div className="text-[12.5px] text-ink/90 whitespace-pre-wrap">{plan.situacion}</div>
        </div>
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-steel mb-1">Resultado esperado</div>
          <div className="text-[12.5px] text-ink/90 whitespace-pre-wrap">{plan.resultadoEsperado}</div>
        </div>
      </div>

      <div className="mb-4">
        <div className="text-[10.5px] font-semibold uppercase tracking-wide text-steel mb-1.5">Tus compromisos</div>
        <div className="space-y-1.5">
          {plan.commitments.map((c) => (
            <div key={c.id} className="text-[12.5px] flex items-center justify-between gap-2 border-b border-rule/60 pb-1.5">
              <span>
                <strong>{c.indicador}:</strong> {c.meta}
              </span>
              <span className="font-mono text-[10px] text-steel shrink-0">{c.responsable === "LIDER" ? "Líder" : "Tú"}</span>
            </div>
          ))}
        </div>
      </div>

      {plan.reviews.length > 0 && (
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-steel mb-1.5">Evaluaciones semanales</div>
          <div className="space-y-2">
            {plan.reviews.map((r) => (
              <div key={r.id} className="border border-rule rounded-md p-3">
                <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                  <span className="text-[11.5px] font-semibold">Semana del {dateOnly(r.weekOf)}</span>
                  <span className="font-mono text-[10.5px] font-semibold" style={{ color: SEMAFORO_META[r.semaforo].color }}>
                    {SEMAFORO_META[r.semaforo].label} · {r.avgScore.toFixed(1)}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[12px]">
                  <div><span className="text-steel">Qué mejoré: </span>{r.queMejoro}</div>
                  <div><span className="text-steel">Qué falta: </span>{r.queFalta}</div>
                  <div><span className="text-steel">Próxima acción: </span>{r.accionSiguiente}</div>
                  <div><span className="text-steel">Apoyo del líder: </span>{r.apoyoLider}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
