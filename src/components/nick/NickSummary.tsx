"use client";

import { useEffect, useState } from "react";
import type { NickSummary as Summary, SummaryNumbers } from "@/lib/nick/summary";

// NICK — Resumen (2026-10-17, solo el admin): la operación en una pantalla.
// Ver src/lib/nick/summary.ts para cómo se cuenta cada número.

const COLOR = {
  VERDE: { text: "Va bien", cls: "text-green" },
  AMARILLO: { text: "Hay que mejorar", cls: "text-amber" },
  ROJO: { text: "Algo está fallando", cls: "text-red" },
} as const;

const n0 = (n: number) => n.toLocaleString("es-EC");
const usd = (n: number) => `$${n.toLocaleString("es-EC")}`;

// Flecha de cambio. good = "up" si subir es bueno, "down" si subir es malo.
function Delta({ now, before, good, unit = "" }: { now: number | null; before: number | null; good: "up" | "down"; unit?: string }) {
  if (now == null || before == null) return null;
  const d = Math.round((now - before) * 10) / 10;
  if (d === 0) return <span className="text-[10.5px] text-steel">= igual que antes</span>;
  const better = good === "up" ? d > 0 : d < 0;
  return (
    <span className={`text-[10.5px] font-semibold ${better ? "text-green" : "text-red"}`}>
      {d > 0 ? "▲" : "▼"} {Math.abs(d)}
      {unit} vs antes ({before}
      {unit})
    </span>
  );
}

function pctChange(now: number, before: number) {
  return before ? Math.round(((now - before) / before) * 1000) / 10 : null;
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface border border-rule rounded-lg p-3 ${className}`}>
      <div className="text-[11px] text-steel mb-0.5">{title}</div>
      {children}
    </div>
  );
}

function DailyBars({ days }: { days: Summary["daily"] }) {
  if (!days.length) return <div className="text-[12px] text-steel">Sin datos todavía.</div>;
  const max = Math.max(...days.map((d) => d.guides), 1);
  return (
    <div>
      <div className="flex items-end gap-[2px] h-[170px]">
        {days.map((d) => {
          const h = (v: number) => `${(v / max) * 100}%`;
          const fin = d.delivered + d.returned;
          return (
            <div key={d.day} className="flex-1 min-w-0 h-full flex flex-col justify-end group relative">
              <div
                title={`${d.day}: ${d.guides} pedidos · ${d.delivered} entregadas · ${d.returned} devueltas · ${d.open} en proceso${fin ? ` · ${Math.round((d.returned / fin) * 100)}% devolución` : ""}`}
                className="flex flex-col justify-end h-full"
              >
                <div className="bg-steel/30 rounded-t-[2px]" style={{ height: h(d.open) }} />
                <div className="bg-red/70" style={{ height: h(d.returned) }} />
                <div className="bg-green/70" style={{ height: h(d.delivered) }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[9.5px] text-steel mt-1">
        <span>{days[0].day}</span>
        <span>{days[days.length - 1].day}</span>
      </div>
      <div className="flex flex-wrap gap-3 text-[10.5px] text-steel mt-1">
        <span>
          <i className="inline-block w-2 h-2 bg-green/70 mr-1" />
          Entregadas
        </span>
        <span>
          <i className="inline-block w-2 h-2 bg-red/70 mr-1" />
          Devueltas o canceladas
        </span>
        <span>
          <i className="inline-block w-2 h-2 bg-steel/30 mr-1" />
          Todavía en proceso
        </span>
        <span>Pasa el mouse sobre un día para ver el detalle.</span>
      </div>
    </div>
  );
}

function rateCls(returnedPct: number | null) {
  if (returnedPct == null) return "";
  return returnedPct <= 15 ? "text-green" : returnedPct <= 25 ? "text-amber" : "text-red";
}

export function NickSummary({ onGoGuides }: { onGoGuides?: () => void }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/nick/summary?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Summary) => alive && (setData(d), setError(null)))
      .catch(() => alive && setError("No se pudo calcular el resumen. Intenta de nuevo en un momento."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [days]);

  if (!data) return <div className="mb-8 text-[12.5px] text-steel">{error ?? "Calculando el resumen…"}</div>;

  const { current: cur, previous: prev, mature: mat, maturePrevious: matPrev, score } = data;
  const sc = score.color ? COLOR[score.color] : null;
  const volChange = pctChange(cur.guides, prev.guides);
  const attTotal = data.attention.reduce((a, x) => a + x.count, 0);

  return (
    <div className={`mb-8 flex flex-col gap-3 ${loading ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10.5px] tracking-[.14em] uppercase text-steel mr-2">Resumen · solo lo ves tú</span>
        {[7, 15, 30].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => {
              setLoading(true);
              setDays(d);
            }}
            className={`rounded-md border px-3 py-1 text-[12px] cursor-pointer ${days === d ? "border-blue bg-blue/10 font-semibold" : "border-rule bg-surface"}`}
          >
            Últimos {d} días
          </button>
        ))}
        {error && <span className="text-[12px] text-red">{error}</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <Card title="Marcador de la operación">
          <div className={`font-display text-[28px] font-bold tabular-nums leading-tight ${sc?.cls ?? ""}`}>
            {score.score ?? "—"}
            <span className="text-[13px] text-steel"> de 100</span>
          </div>
          <div className={`text-[11px] font-semibold ${sc?.cls ?? "text-steel"}`}>
            {sc?.text ?? "Sin datos"}
            {score.provisional ? " · provisional" : ""}
          </div>
        </Card>
        <Card title={`Pedidos · últimos ${data.periodDays} días`}>
          <div className="font-display text-[28px] font-bold tabular-nums leading-tight">{n0(cur.guides)}</div>
          {volChange != null && (
            <div className={`text-[10.5px] font-semibold ${volChange >= 0 ? "text-green" : "text-red"}`}>
              {volChange >= 0 ? "▲" : "▼"} {Math.abs(volChange)}% vs {data.periodDays} días antes ({n0(prev.guides)})
            </div>
          )}
          <div className="text-[10.5px] text-steel">≈ {n0(Math.round(cur.guides / data.periodDays))} por día</div>
        </Card>
        <Card title="Entrega real (órdenes de hace 15–30 días)">
          <div className={`font-display text-[28px] font-bold tabular-nums leading-tight ${rateCls(mat.returnedPct)}`}>{mat.deliveredPct ?? "—"}%</div>
          <Delta now={mat.deliveredPct} before={matPrev.deliveredPct} good="up" unit="%" />
          <div className="text-[10.5px] text-steel">
            {n0(mat.delivered)} entregadas de {n0(mat.delivered + mat.returned)} terminadas
          </div>
        </Card>
        <Card title="Devolución real (hace 15–30 días)">
          <div className={`font-display text-[28px] font-bold tabular-nums leading-tight ${rateCls(mat.returnedPct)}`}>{mat.returnedPct ?? "—"}%</div>
          <Delta now={mat.returnedPct} before={matPrev.returnedPct} good="down" unit="%" />
          <div className="text-[10.5px] text-steel">{n0(mat.returned)} devueltas o canceladas</div>
        </Card>
        <Card title="En la calle ahora">
          <div className="font-display text-[28px] font-bold tabular-nums leading-tight">{n0(cur.inTransit + cur.novelty)}</div>
          <div className="text-[10.5px] text-steel">
            {n0(cur.inTransit)} en camino · <span className={cur.novelty ? "text-amber font-semibold" : ""}>{n0(cur.novelty)} con novedad</span>
          </div>
          <div className="text-[10.5px] text-steel">de los pedidos de los últimos {data.periodDays} días</div>
        </Card>
        <Card title="Días hasta entregar">
          <div className="font-display text-[28px] font-bold tabular-nums leading-tight">{data.deliveryDays.avg ?? "—"}</div>
          {data.deliveryDays.avg != null ? (
            <Delta now={data.deliveryDays.avg} before={data.deliveryDays.previousAvg} good="down" unit=" días" />
          ) : (
            <div className="text-[10.5px] text-steel">
              Se empieza a medir: NICK necesita ver las guías antes de que se entreguen ({data.deliveryDays.guides} de 20 por ahora).
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start">
        <div className="bg-surface border border-rule rounded-lg p-3">
          <div className="text-[13px] font-semibold">Pedidos por día (45 días) y cómo terminaron</div>
          <div className="text-[11px] text-steel mb-2">
            Los días recientes se ven grises porque esas guías siguen en camino: la devolución tarda ~15 días en aparecer.
          </div>
          <DailyBars days={data.daily} />
        </div>

        <div className="flex flex-col gap-3">
          <div className="bg-surface border border-rule rounded-lg p-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="text-[13px] font-semibold">Requiere atención ({n0(attTotal)})</div>
              {onGoGuides && (
                <button type="button" onClick={onGoGuides} className="text-[11.5px] text-blue underline cursor-pointer">
                  Ver las guías
                </button>
              )}
            </div>
            <ul className="flex flex-col text-[12px]">
              {data.attention.map((a) => (
                <li key={a.key} className="flex justify-between gap-2 border-t border-rule py-1 first:border-t-0" title={a.hint}>
                  <span className={a.count ? "" : "text-steel"}>{a.label}</span>
                  <span className={`tabular-nums font-semibold ${a.count ? "text-amber" : "text-steel"}`}>{n0(a.count)}</span>
                </li>
              ))}
            </ul>
          </div>
          {score.money && (
            <div className="grid grid-cols-3 gap-2">
              <Card title="En riesgo">
                <div className="font-display text-[18px] font-bold tabular-nums text-amber">{usd(score.money.atRisk)}</div>
                <div className="text-[10px] text-steel">{n0(score.money.atRiskGuides)} guías estancadas o con novedad</div>
              </Card>
              <Card title="Perdido (costo)">
                <div className="font-display text-[18px] font-bold tabular-nums text-red">{usd(score.money.lost)}</div>
                <div className="text-[10px] text-steel">{n0(score.money.lostGuides)} devoluciones sin llegar</div>
              </Card>
              <Card title="Recuperado (costo)">
                <div className="font-display text-[18px] font-bold tabular-nums text-green">{usd(score.money.recovered)}</div>
                <div className="text-[10px] text-steel">{n0(score.money.recoveredGuides)} devoluciones de vuelta</div>
              </Card>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
        <div className="bg-surface border border-rule rounded-lg p-3">
          <div className="text-[13px] font-semibold mb-1">Qué hacer primero</div>
          {score.recommendations.length ? (
            <ol className="list-decimal pl-5 flex flex-col gap-1 text-[12.5px]">
              {score.recommendations.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ol>
          ) : (
            <div className="text-[12px] text-steel">Nada urgente por ahora.</div>
          )}
        </div>

        <div className="bg-surface border border-rule rounded-lg overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-steel font-mono text-[10px] uppercase tracking-wide">
                <th className="py-2 px-3">Cuenta</th>
                <th className="py-2 pr-3 text-right">Pedidos {data.periodDays} d</th>
                <th className="py-2 pr-3 text-right">En camino</th>
                <th className="py-2 pr-3 text-right">Novedad</th>
                <th className="py-2 pr-3 text-right" title="Órdenes de hace 15–30 días">Entrega real</th>
                <th className="py-2 pr-3 text-right" title="Órdenes de hace 15–30 días">Devolución real</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => (
                <AccountRow key={a.id} name={a.name} period={a.period} mature={a.mature} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AccountRow({ name, period, mature }: { name: string; period: SummaryNumbers; mature: SummaryNumbers }) {
  return (
    <tr className="border-t border-rule">
      <td className="py-1.5 px-3 font-semibold">{name}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{n0(period.guides)}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{n0(period.inTransit)}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{n0(period.novelty)}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{mature.deliveredPct == null ? "—" : `${mature.deliveredPct}%`}</td>
      <td className={`py-1.5 pr-3 text-right tabular-nums font-semibold ${rateCls(mature.returnedPct)}`}>
        {mature.returnedPct == null ? "—" : `${mature.returnedPct}%`}
      </td>
    </tr>
  );
}
