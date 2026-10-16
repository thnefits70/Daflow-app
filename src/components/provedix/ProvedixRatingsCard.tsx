"use client";

import { useState } from "react";
import type { RatingsOverview } from "@/lib/provedixRatings";
import { PUBLIC_MIN_AVG, PUBLIC_MIN_RATINGS, RATING_TOOLS, type RatingTool } from "@/lib/provedixRatingTools";

// Calificaciones de provedix.com (pedido del usuario 2026-10-15): solo el
// admin. Promedio por herramienta, cómo va por semana y los comentarios con
// las notas bajas primero (ahí está lo que hay que mejorar).
function stars(n: number) {
  return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);
}

function fmt(n: number | null) {
  return n == null ? "—" : n.toFixed(1).replace(".", ",");
}

function day(iso: string) {
  return new Date(iso).toLocaleDateString("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "2-digit", year: "numeric" });
}

export function ProvedixRatingsCard({ data }: { data: RatingsOverview }) {
  const [tool, setTool] = useState<RatingTool | "all">("all");
  const [onlyLow, setOnlyLow] = useState(false);
  const comments = data.comments.filter((c) => (tool === "all" || c.tool === tool) && (!onlyLow || c.stars <= 3));

  return (
    <div className="bg-surface border border-rule rounded-lg p-5 mb-7">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[13px] font-semibold">Calificaciones de la página</div>
          <div className="text-[11px] text-steel max-w-[620px]">
            Los registrados califican de 1 a 5 estrellas la herramienta que usaron, con comentario opcional. Solo tú ves esto; en provedix.com no se
            muestra nada todavía. Si alguien vuelve a calificar, el promedio usa su nota más nueva.
          </div>
        </div>
        <span className="text-[11px] font-semibold rounded-full border border-rule bg-cloud px-3 py-1 text-steel">🔒 Solo tú</span>
      </div>

      <div className="mt-4 grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="border border-rule rounded-lg p-3">
          <div className="text-[11px] text-steel">General</div>
          <div className="font-display text-[26px] font-bold tabular-nums">{fmt(data.avg)}</div>
          <div className="text-[11px] text-steel tabular-nums">{data.total} calificaciones</div>
        </div>
        {data.tools.map((t) => (
          <div key={t.tool} className="border border-rule rounded-lg p-3">
            <div className="text-[11px] text-steel">{t.label}</div>
            <div className="font-display text-[26px] font-bold tabular-nums">
              {fmt(t.avg)}
              {t.avg != null && <span className="ml-1 text-[13px] text-[#c27c00]">★</span>}
            </div>
            <div className="text-[11px] text-steel tabular-nums">
              {t.count} {t.count === 1 ? "persona" : "personas"}
              {t.last30Count > 0 && ` · últimos 30 días ${fmt(t.last30Avg)}`}
            </div>
            {t.count > 0 && (
              <div className="mt-2 space-y-0.5">
                {[5, 4, 3, 2, 1].map((s) => (
                  <div key={s} className="flex items-center gap-1.5 text-[10px] text-steel tabular-nums">
                    <span className="w-3">{s}</span>
                    <div className="h-1.5 flex-1 rounded-full bg-cloud overflow-hidden">
                      <div className="h-full rounded-full bg-[#e0a100]" style={{ width: `${(t.dist[s - 1] / t.count) * 100}%` }} />
                    </div>
                    <span className="w-4 text-right">{t.dist[s - 1]}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={`mt-3 rounded-lg border px-3 py-2 text-[12px] ${data.readyForPublic ? "border-teal/50 bg-teal/10" : "border-rule bg-cloud"}`}>
        {data.readyForPublic
          ? `✅ Ya se cumple la meta para mostrar opiniones en la página (${data.total} calificaciones, promedio ${fmt(data.avg)}). ${data.publicComments} comentarios de 4–5 estrellas con permiso para mostrarse. Avísame cuando quieras activarlo.`
          : `Meta para mostrar opiniones en la página: al menos ${PUBLIC_MIN_RATINGS} calificaciones y promedio ${fmt(PUBLIC_MIN_AVG)} o más. Hoy: ${data.total} y ${fmt(data.avg)}.`}
      </div>

      {data.weeks.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <div className="text-[12px] font-semibold mb-1">Cómo va por semana</div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wide text-steel">
                <th className="pb-1.5 pr-3 font-semibold">Semana del</th>
                <th className="pb-1.5 pr-3 font-semibold text-right">Calificaciones</th>
                <th className="pb-1.5 font-semibold text-right">Promedio</th>
              </tr>
            </thead>
            <tbody>
              {data.weeks.map((w) => (
                <tr key={w.week} className="border-t border-rule">
                  <td className="py-1.5 pr-3 tabular-nums">{w.week.split("-").reverse().join("/")}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{w.count}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmt(w.avg)} ★</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[12px] font-semibold">Comentarios ({comments.length})</div>
        <div className="flex items-center gap-2 flex-wrap text-[11.5px]">
          <select value={tool} onChange={(e) => setTool(e.target.value as RatingTool | "all")} className="border border-rule rounded-md bg-surface px-2 py-1">
            <option value="all">Todas las herramientas</option>
            {(Object.keys(RATING_TOOLS) as RatingTool[]).map((t) => (
              <option key={t} value={t}>
                {RATING_TOOLS[t]}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />
            Solo 1 a 3 estrellas
          </label>
        </div>
      </div>
      {comments.length === 0 ? (
        <div className="mt-2 text-[12px] text-steel">Todavía no hay comentarios.</div>
      ) : (
        <div className="mt-2 divide-y divide-rule border border-rule rounded-lg max-h-[420px] overflow-y-auto">
          {comments.map((c) => (
            <div key={c.id} className={`p-3 ${c.stars <= 2 ? "bg-[#fdecea]/60 dark:bg-[#5a1d17]/25" : ""}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap text-[11px] text-steel">
                <span>
                  <span className="text-[13px] text-[#c27c00] tracking-tight">{stars(c.stars)}</span> · {RATING_TOOLS[c.tool]}
                </span>
                <span className="tabular-nums">{day(c.createdAt)}</span>
              </div>
              <div className="mt-1 text-[12.5px] whitespace-pre-wrap">{c.comment}</div>
              <div className="mt-1 text-[11px] text-steel">
                {c.name}
                {c.storeName ? ` · ${c.storeName}` : ""}
                {c.allowPublic && " · ✅ permite mostrarlo en la página"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
