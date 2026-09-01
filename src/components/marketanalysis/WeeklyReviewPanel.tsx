"use client";

import { PushTypeToggle } from "@/components/shared/PushTypeToggle";

export type WeeklyReviewDTO = {
  id: string;
  week: string;
  problem: string;
  actionPlan: string;
  status: "PENDING" | "RESOLVED" | "REJECTED";
  // Campos del feedback semanal con Mary (ver src/lib/weeklyCheckin.ts) —
  // opcionales por registros históricos previos a Mary.
  source?: "ADMIN_MANUAL" | "ASSISTANT";
  reportedByName?: string | null;
  involvesDeptName?: string | null;
  involvesRaw?: string | null;
  involvedNotifiedAt?: string | null;
  // Qué hizo el líder para resolverlo, según Mary (ver
  // close_previous_report) — null si sigue Pendiente.
  resolutionNote?: string | null;
  // Cuántas semanas ISO lleva Pendiente (0 = esta misma semana) — se
  // computa en el servidor (weeksStaleOf en weeklyCheckin.ts), nunca en el
  // cliente, para que no dependa de la hora local del navegador.
  weeksStale?: number;
};

export type InvolvingMeReviewDTO = {
  id: string;
  week: string;
  problem: string;
  actionPlan: string;
  status: "PENDING" | "RESOLVED" | "REJECTED";
  fromDeptName: string;
};

const STATUS_META: Record<WeeklyReviewDTO["status"], { label: string; color: string }> = {
  PENDING: { label: "Pendiente", color: "#92A3C0" },
  RESOLVED: { label: "Solucionado", color: "#14C7C7" },
  REJECTED: { label: "Rechazado", color: "#C4453A" },
};

function formatWeek(week: string) {
  const [year, w] = week.split("-W");
  return `Semana ${Number(w)} · ${year}`;
}

// Bitácora de feedback semanal: 100% lectura, para todo el mundo (admin
// incluido). El único que escribe registros nuevos es Mary, conversando
// con el líder de cada área (ver WeeklyCheckinPanel) — ya no existe una
// forma manual de crear, editar o cerrar un registro a mano; esto es
// deliberado, para que "Solucionado" siempre venga con una explicación
// real que Mary recogió, nunca de un botón. Esta vista es puramente para
// que el admin pueda leer semana a semana lo que cada área reportó y
// decidir si necesita darle seguimiento él mismo.
export function WeeklyReviewPanel({
  records,
  involvingMe = [],
}: {
  deptId: string;
  records: WeeklyReviewDTO[];
  // Registros de OTRAS áreas que nombraron a este departamento o a uno de
  // sus colaboradores — solo lectura.
  involvingMe?: InvolvingMeReviewDTO[];
}) {
  const sorted = [...records].sort((a, b) => (a.week < b.week ? 1 : -1));

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-[13px] text-steel">
          Feedback semanal: lo que cada área reportó a Mary — problemas de la semana y plan de acción. Solo lectura.
        </div>
        <PushTypeToggle type="feedback" />
      </div>

      {sorted.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Aún no hay registros de feedback semanal.
        </div>
      )}

      {sorted.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left border-b border-rule">
                <th className="py-2 pr-3 text-[10.5px] font-semibold uppercase tracking-wide text-steel whitespace-nowrap">
                  Semana
                </th>
                <th className="py-2 pr-3 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                  Problema / cosas por mejorar
                </th>
                <th className="py-2 pr-3 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                  Plan a ejecutar
                </th>
                <th className="py-2 pr-3 text-[10.5px] font-semibold uppercase tracking-wide text-steel whitespace-nowrap">
                  Estado
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-b border-rule align-top">
                  <td className="py-3 pr-3 text-[13px] font-semibold whitespace-nowrap">
                    {formatWeek(r.week)}
                    {r.source === "ASSISTANT" && (
                      <div className="mt-1 font-mono text-[9.5px] font-normal normal-case text-teal">🤖 {r.reportedByName ?? "Mary"}</div>
                    )}
                    {r.status === "PENDING" && !!r.weeksStale && r.weeksStale >= 2 && (
                      <div
                        className="mt-1 inline-flex items-center gap-1 font-mono text-[9.5px] font-semibold normal-case px-1.5 py-0.5 rounded-full"
                        style={{ color: "#C4453A", border: "1px solid #C4453A", background: "#C4453A1a" }}
                        title="Sigue Pendiente sin que Mary lo haya podido cerrar"
                      >
                        🕑 {r.weeksStale} semanas
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-[13px] text-ink/90 max-w-[280px]">
                    {r.problem}
                    {(r.involvesDeptName || r.involvesRaw) && (
                      <div
                        className="mt-1.5 inline-flex items-center gap-1 font-mono text-[9.5px] font-semibold px-2 py-0.5 rounded-full"
                        style={
                          r.involvedNotifiedAt
                            ? { color: "#92A3C0", border: "1px solid #92A3C0", background: "#92A3C01a" }
                            : { color: "#C4453A", border: "1px solid #C4453A", background: "#C4453A1a" }
                        }
                        title={r.involvedNotifiedAt ? "Ya se avisó" : "Sin líder a quien avisar — seguimiento manual"}
                      >
                        ↔ Implica a {r.involvesDeptName ?? r.involvesRaw}
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-[13px] text-ink/90 max-w-[280px]">{r.actionPlan}</td>
                  <td className="py-3 pr-3 whitespace-nowrap">
                    <span
                      className="font-mono text-[10.5px] font-semibold px-2.5 py-1 rounded-full"
                      style={{
                        color: STATUS_META[r.status].color,
                        border: `1px solid ${STATUS_META[r.status].color}`,
                        background: `${STATUS_META[r.status].color}1a`,
                      }}
                    >
                      {STATUS_META[r.status].label}
                    </span>
                    {r.status === "RESOLVED" && r.resolutionNote && (
                      <div className="mt-1.5 text-[10.5px] text-steel max-w-[160px] whitespace-normal" title="Lo que reportó al asistente">
                        “{r.resolutionNote}”
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {involvingMe.length > 0 && (
        <div className="mt-6">
          <div className="text-[13px] font-semibold mb-1">Reportes que me involucran</div>
          <div className="text-[12px] text-steel mb-3">
            Problemas de otras áreas cuyo plan de acción menciona a tu equipo — solo lectura, el cierre le corresponde al área dueña.
          </div>
          <div className="space-y-2">
            {involvingMe.map((r) => (
              <div key={r.id} className="border border-rule rounded-md p-3 bg-cloud/40">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[11px] font-mono font-semibold text-steel">
                    {formatWeek(r.week)} · {r.fromDeptName}
                  </span>
                  <span
                    className="font-mono text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      color: STATUS_META[r.status].color,
                      border: `1px solid ${STATUS_META[r.status].color}`,
                      background: `${STATUS_META[r.status].color}1a`,
                    }}
                  >
                    {STATUS_META[r.status].label}
                  </span>
                </div>
                <div className="text-[12.5px] text-ink/90 mb-1">{r.problem}</div>
                <div className="text-[12px] text-steel">{r.actionPlan}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
