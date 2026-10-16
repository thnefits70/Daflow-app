"use client";

import { useState } from "react";
import type { MichelleFunnel } from "@/lib/provedixMichelleFunnel";
import { formatDateTime } from "@/lib/formatDateTime";

// Embudo de Michelle IA (2026-10-17): de abrir el chat a terminar con éxito,
// con los frenos de cada paso. Solo el admin.
export function MichelleFunnelCard({ week, month }: { week: MichelleFunnel; month: MichelleFunnel }) {
  const [range, setRange] = useState<7 | 30>(7);
  const f = range === 7 ? week : month;
  const top = Math.max(1, ...f.steps.map((s) => s.value));
  return (
    <div className="bg-surface border border-rule rounded-lg p-5 mb-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div className="text-[13px] font-semibold">Embudo de Michelle IA</div>
        <div className="flex rounded-full border border-rule p-0.5">
          {([7, 30] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setRange(d)}
              className={`rounded-full px-3 py-1 text-[12px] font-semibold cursor-pointer ${range === d ? "bg-ink text-bg" : "text-steel hover:text-ink"}`}
            >
              {d} días
            </button>
          ))}
        </div>
      </div>
      <p className="text-[12px] text-steel mb-4 max-w-[680px]">
        Cuántas personas pasan de un paso al siguiente, desde que abren el chat hasta que su conversación termina con éxito (Michelle IA respondió, sin
        bloqueo y, si pasó al equipo, el equipo ya respondió). El porcentaje es contra el paso anterior.
        {f.trackingSince ? ` Las aperturas del chat se miden desde el ${formatDateTime(f.trackingSince)}.` : " Las aperturas del chat se empiezan a medir desde hoy."}
      </p>

      <div className="flex flex-col gap-2">
        {f.steps.map((s, i) => (
          <div key={s.key} className="grid grid-cols-[minmax(0,220px)_1fr_auto] items-center gap-3">
            <div className="text-[12.5px]">
              <span className="font-mono text-steel">{i + 1}.</span> {s.label}
            </div>
            <div className="h-6 overflow-hidden rounded bg-cloud">
              <div className={`h-full rounded ${i === f.steps.length - 1 ? "bg-teal" : "bg-ink/70"}`} style={{ width: `${(s.value / top) * 100}%` }} />
            </div>
            <div className="w-28 text-right text-[12.5px]">
              <b className="font-mono">{s.value}</b>
              {s.pct != null && <span className={`ml-1.5 ${s.pct < 50 ? "text-red" : "text-steel"}`}>{s.pct}%</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="text-[12px] font-semibold mb-1.5">Dónde se frenan</div>
          <ul className="flex flex-col gap-1">
            {f.brakes.map((b) => (
              <li key={b.key} className={`flex items-baseline justify-between gap-3 rounded-md px-2.5 py-1.5 text-[12.5px] ${b.value > 0 ? "bg-cloud" : ""}`} title={b.hint}>
                <span>
                  {b.label}
                  <span className="block text-[11px] text-steel">{b.hint}</span>
                </span>
                <b className={`font-mono ${b.value > 0 ? "text-red" : "text-steel"}`}>{b.value}</b>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[12px] font-semibold mb-1.5">Por dónde abren el chat</div>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] text-steel">
                <th className="py-1 font-semibold">Entrada</th>
                <th className="py-1 text-right font-semibold">Abrieron</th>
                <th className="py-1 text-right font-semibold">Escribieron</th>
              </tr>
            </thead>
            <tbody>
              {f.sources.map((s) => (
                <tr key={s.source} className="border-t border-rule">
                  <td className="py-1.5">{s.label}</td>
                  <td className="py-1.5 text-right font-mono">{s.opened}</td>
                  <td className="py-1.5 text-right font-mono">
                    {s.wrote}
                    {s.opened > 0 && <span className="ml-1 text-steel">({Math.round((s.wrote / s.opened) * 100)}%)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 grid grid-cols-2 gap-2 text-[12.5px]">
            <div className="rounded-md bg-cloud px-3 py-2">
              <div className="text-[11px] text-steel">Conversaciones</div>
              <b className="font-mono text-[16px]">{f.conversations}</b>
              <span className="ml-1 text-steel">· {f.avgMessages ?? "–"} msj c/u</span>
            </div>
            <div className="rounded-md bg-cloud px-3 py-2">
              <div className="text-[11px] text-steel">Con éxito</div>
              <b className="font-mono text-[16px]">{f.successPct != null ? `${f.successPct}%` : "–"}</b>
              <span className="ml-1 text-steel">({f.success})</span>
            </div>
            <div className="rounded-md bg-cloud px-3 py-2">
              <div className="text-[11px] text-steel">Pasaron al equipo</div>
              <b className="font-mono text-[16px]">{f.escalated}</b>
              <span className="ml-1 text-steel">· {f.teamAnswered} respondidos</span>
            </div>
            <div className="rounded-md bg-cloud px-3 py-2">
              <div className="text-[11px] text-steel">Calificación de Michelle IA</div>
              <b className="font-mono text-[16px]">{f.rating.avg != null ? `${f.rating.avg} ★` : "–"}</b>
              <span className="ml-1 text-steel">({f.rating.count})</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
