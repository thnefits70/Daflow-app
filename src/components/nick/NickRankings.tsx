"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { NickRankings as Rankings, RankRow } from "@/lib/nick/rankings";

// NICK Etapa 4 (2026-10-16): rankings de tiendas, productos y
// transportadoras con el estado real de Dropi. Solo el admin. Sin montos.

const LABEL: Record<RankRow["label"], { text: string; cls: string }> = {
  BUENA: { text: "Buena", cls: "bg-green/15 text-green" },
  REVISAR: { text: "Revisar", cls: "bg-amber/20 text-amber" },
  RIESGO: { text: "Riesgo", cls: "bg-red/15 text-red" },
};

function Table({ rows, nameTitle, empty }: { rows: RankRow[]; nameTitle: string; empty: string }) {
  const [showAll, setShowAll] = useState(false);
  if (!rows.length) return <div className="p-4 text-[12px] text-steel">{empty}</div>;
  const visible = showAll ? rows : rows.slice(0, 15);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-steel font-mono text-[10px] uppercase tracking-wide">
              <th className="py-2 px-3">{nameTitle}</th>
              <th className="py-2 pr-3 text-right">Guías</th>
              <th className="py-2 pr-3 text-right">Finalizadas</th>
              <th className="py-2 pr-3 text-right">% entregadas</th>
              <th className="py-2 pr-3 text-right">% devueltas</th>
              <th className="py-2 pr-3 text-right">En camino</th>
              <th className="py-2 pr-3 text-right">Novedad</th>
              <th className="py-2 pr-3">Etiqueta</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.key} className="border-t border-rule">
                <td className="py-1.5 px-3">
                  {r.name}
                  {r.name !== r.key && <span className="ml-1.5 font-mono text-[10px] text-steel">{r.key}</span>}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{r.guides.toLocaleString("es-EC")}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{r.finished.toLocaleString("es-EC")}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{r.deliveredPct}%</td>
                <td className="py-1.5 pr-3 text-right tabular-nums font-semibold">{r.returnedPct}%</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{r.inTransit}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{r.novelty}</td>
                <td className="py-1.5 pr-3">
                  <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${LABEL[r.label].cls}`}>{LABEL[r.label].text}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 15 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="m-3 text-[12px] text-blue underline cursor-pointer">
          {showAll ? "Ver menos" : `Ver las ${rows.length}`}
        </button>
      )}
    </>
  );
}

export function NickRankings({ accounts }: { accounts: { id: string; name: string }[] }) {
  const [days, setDays] = useState(30);
  const [account, setAccount] = useState("");
  const [city, setCity] = useState("");
  const [tab, setTab] = useState<"stores" | "products" | "carriers">("stores");
  const [data, setData] = useState<Rankings | null>(null);
  const [loading, setLoading] = useState(true);

  const url = useMemo(() => {
    const p = new URLSearchParams({ days: String(days) });
    if (account) p.set("account", account);
    if (city) p.set("city", city);
    return `/api/nick/rankings?${p.toString()}`;
  }, [days, account, city]);
  const load = useCallback(() => {
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Rankings | null) => d && setData(d))
      .finally(() => setLoading(false));
  }, [url]);
  useEffect(load, [load]);

  const change = (fn: () => void) => {
    fn();
    setLoading(true);
  };

  const counts = (rows: RankRow[]) => ({
    riesgo: rows.filter((r) => r.label === "RIESGO").length,
    revisar: rows.filter((r) => r.label === "REVISAR").length,
  });

  const TABS = [
    { key: "stores", label: "Tiendas", rows: data?.stores ?? [] },
    { key: "products", label: "Productos", rows: data?.products ?? [] },
    { key: "carriers", label: "Transportadoras", rows: data?.carriers ?? [] },
  ] as const;

  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <div className="font-mono text-[10.5px] tracking-[.14em] uppercase text-steel">Rankings · solo lo ves tú</div>
          <div className="text-[11.5px] text-steel mt-1">
            % sobre guías finalizadas (entregadas + devueltas). Buena ≤ 15% de devolución · Revisar 15–25% · Riesgo &gt; 25%. Mínimo 20 guías finalizadas.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <select value={days} onChange={(e) => change(() => setDays(Number(e.target.value)))} className="bg-surface border border-rule rounded px-2 py-1.5">
            <option value={7}>Últimos 7 días</option>
            <option value={30}>Últimos 30 días</option>
            <option value={45}>Últimos 45 días</option>
          </select>
          <select value={account} onChange={(e) => change(() => setAccount(e.target.value))} className="bg-surface border border-rule rounded px-2 py-1.5">
            <option value="">Todas las cuentas</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {TABS.map((t) => {
          const c = counts(t.rows);
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-md border px-3 py-1.5 text-[12.5px] cursor-pointer ${tab === t.key ? "border-blue bg-blue/10 font-semibold" : "border-rule bg-surface"}`}
            >
              {t.label} <span className="text-steel">({t.rows.length})</span>
              {c.riesgo > 0 && <span className="ml-1.5 text-[10px] font-semibold rounded-full bg-red/15 text-red px-1.5">{c.riesgo} riesgo</span>}
            </button>
          );
        })}
      </div>

      <div className={`bg-surface border border-rule rounded-lg ${loading ? "opacity-60" : ""}`}>
        {!data ? (
          <div className="p-5 text-[12px] text-steel">Cargando rankings…</div>
        ) : tab === "stores" ? (
          <Table rows={data.stores} nameTitle="Tienda (remitente de la etiqueta)" empty="Ninguna tienda llega a 20 guías finalizadas en este período." />
        ) : tab === "products" ? (
          <Table rows={data.products} nameTitle="Producto" empty="Ningún producto llega a 20 guías finalizadas en este período." />
        ) : (
          <>
            <Table rows={data.carriers} nameTitle="Transportadora" empty="Sin datos en este período." />
            <div className="border-t border-rule p-3">
              <div className="flex flex-wrap items-center gap-2 text-[12px] mb-2">
                <span className="font-semibold">Mejor transportadora por ciudad:</span>
                <select value={city} onChange={(e) => change(() => setCity(e.target.value))} className="bg-surface border border-rule rounded px-2 py-1.5">
                  <option value="">Elige una ciudad</option>
                  {data.cities.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              {city && data.cityCarriers && (
                <Table rows={data.cityCarriers} nameTitle={`Transportadora en ${city} (de mejor a peor)`} empty="Ninguna transportadora llega a 10 guías finalizadas en esta ciudad." />
              )}
            </div>
          </>
        )}
      </div>
      <div className="text-[10.5px] text-steel mt-2">
        Tiendas y productos salen de los cortes (desde el 21/09); transportadoras, de todas las guías de NICK. Las devueltas incluyen rechazadas y canceladas después de salir.
      </div>
    </div>
  );
}
