"use client";

import { useEffect, useState } from "react";
import { CatalogCode } from "@/components/shared/CatalogCode";

type Status = "VENDIENDO" | "BAJANDO" | "QUIETO" | "NUEVO";
type Product = {
  code: string;
  name: string;
  photo: string | null;
  source: string;
  linkedByName: string | null;
  weeks: { start: string; orders: number }[];
  last7: number;
  prevAvg: number | null;
  lastOrderDay: string | null;
  daysWithoutOrders: number | null;
  status: Status;
};
type Store = { id: string; name: string; labelSender: string | null; products: Product[] };
type Unlinked = { code: string; name: string; orders: number; lastOrderDay: string };
type Data = {
  today: string;
  historyStart: string | null;
  stores: Store[];
  unlinked: Unlinked[];
  storeOptions: { id: string; name: string }[];
  canLink: boolean;
};

const STATUS: Record<Status, { dot: string; label: string; cls: string }> = {
  QUIETO: { dot: "🔴", label: "Quieto — recordar pauta", cls: "text-red" },
  BAJANDO: { dot: "🟡", label: "Bajando — recordar pauta", cls: "text-amber" },
  NUEVO: { dot: "🔵", label: "Nuevo — todavía sin historial para comparar", cls: "text-steel" },
  VENDIENDO: { dot: "🟢", label: "Vendiendo", cls: "text-green" },
};

function fmtDay(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("es-EC", { day: "numeric", month: "short", timeZone: "UTC" });
}

// Barras de pedidos por semana. Las semanas antes de que existieran datos se
// ven vacías (con borde punteado) para no confundirlas con "no se vendió".
function WeekBars({ weeks, historyStart }: { weeks: Product["weeks"]; historyStart: string | null }) {
  const max = Math.max(1, ...weeks.map((w) => w.orders));
  return (
    <div className="flex items-end gap-[3px] h-10" aria-label="Pedidos por semana">
      {weeks.map((w, i) => {
        const noData = !historyStart || addDaysStr(w.start, 7) <= historyStart;
        const current = i === weeks.length - 1;
        const h = w.orders === 0 ? 2 : Math.max(4, Math.round((w.orders / max) * 40));
        return (
          <div
            key={w.start}
            title={noData ? `Semana del ${fmtDay(w.start)}: sin datos todavía` : `Semana del ${fmtDay(w.start)}: ${w.orders} pedido${w.orders === 1 ? "" : "s"}${current ? " (en curso)" : ""}`}
            className={`w-[14px] rounded-t-sm ${noData ? "border border-dashed border-rule" : current ? "bg-teal/60" : "bg-teal"}`}
            style={{ height: noData ? 40 : h }}
          />
        );
      })}
    </div>
  );
}

function addDaysStr(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function ProductRow({ p, historyStart }: { p: Product; historyStart: string | null }) {
  const s = STATUS[p.status];
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-rule last:border-b-0">
      {p.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img loading="lazy" decoding="async" src={p.photo} alt="" className="w-11 h-11 rounded object-cover bg-cloud shrink-0" />
      ) : (
        <div className="w-11 h-11 rounded bg-cloud shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold text-ink truncate" title={p.name}>{p.name}</div>
        <div className="flex items-center gap-1 text-[11.5px] text-steel">
          ID <CatalogCode code={p.code} size="text-[11.5px]" />
        </div>
        <div className={`text-[12px] font-semibold mt-0.5 ${s.cls}`}>
          {s.dot} {s.label}
        </div>
        <div className="text-[11.5px] text-steel">
          Últimos 7 días: <b className="text-ink">{p.last7}</b> pedido{p.last7 === 1 ? "" : "s"}
          {p.prevAvg !== null && <> · antes ~{p.prevAvg.toFixed(1)} por semana</>}
          {p.lastOrderDay ? <> · último: {fmtDay(p.lastOrderDay)}{p.daysWithoutOrders ? ` (hace ${p.daysWithoutOrders} día${p.daysWithoutOrders === 1 ? "" : "s"})` : " (hoy)"}</> : <> · sin pedidos en las guías</>}
        </div>
      </div>
      <WeekBars weeks={p.weeks} historyStart={historyStart} />
    </div>
  );
}

function UnlinkedBox({ items, stores, canLink, onDone }: { items: Unlinked[]; stores: Data["storeOptions"]; canLink: boolean; onDone: () => void }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function link(codes: string[], key: string) {
    if (!storeId) return;
    setBusy(key);
    setError(null);
    const r = await fetch("/api/store-tracking/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes, storeId }),
    }).catch(() => null);
    setBusy(null);
    if (!r || !r.ok) {
      const j = r ? await r.json().catch(() => null) : null;
      setError(j?.error ?? "No se pudo vincular.");
      return;
    }
    onDone();
  }

  return (
    <div className="rounded-md border border-amber/60 bg-surface p-3 mb-4">
      <div className="text-[13.5px] font-bold text-ink">⚠ {items.length} producto{items.length === 1 ? "" : "s"} de Importadora Shanghai sin tienda</div>
      <div className="text-[12px] text-steel mb-2">
        {canLink
          ? "Salieron en las guías pero su etiqueta no dijo de qué tienda son. Elige la tienda y vincúlalos — así entran al seguimiento."
          : "Salieron en las guías pero todavía no tienen tienda. Yair es quien los vincula."}
      </div>
      {canLink && stores.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <label className="text-[12px] text-steel">Tienda:</label>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="rounded border border-rule bg-surface2 px-2 py-1 text-[12.5px] text-ink">
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {items.length > 1 && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => link(items.map((i) => i.code), "all")}
              className="rounded bg-teal px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-50 cursor-pointer"
            >
              {busy === "all" ? "Vinculando…" : `Vincular los ${items.length}`}
            </button>
          )}
        </div>
      )}
      {items.map((i) => (
        <div key={i.code} className="flex items-center gap-2 py-1.5 border-t border-rule text-[12.5px]">
          <div className="min-w-0 flex-1">
            <div className="text-ink font-semibold truncate">{i.name}</div>
            <div className="text-steel text-[11.5px] flex items-center gap-1">
              ID <CatalogCode code={i.code} size="text-[11.5px]" /> · {i.orders} pedido{i.orders === 1 ? "" : "s"} · último {fmtDay(i.lastOrderDay)}
            </div>
          </div>
          {canLink && (
            <button
              type="button"
              disabled={!!busy || !storeId}
              onClick={() => link([i.code], i.code)}
              className="rounded border border-teal px-2.5 py-1 text-[12px] font-semibold text-teal disabled:opacity-50 cursor-pointer shrink-0"
            >
              {busy === i.code ? "…" : "Vincular"}
            </button>
          )}
        </div>
      ))}
      {error && <div className="text-[12px] text-red mt-1">{error}</div>}
    </div>
  );
}

// Seguimiento de tiendas (Análisis de Mercado) — pedido del usuario
// 2026-10-01. Solo lectura para Yair, Bryan y admin; Yair además vincula los
// IDs de Shanghai que salgan sin tienda.
export function StoreTrackingPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch("/api/store-tracking")
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) setError(j.error ?? "No se pudo cargar.");
        else setData(j);
      })
      .catch(() => setError("No se pudo cargar."));
  }
  useEffect(load, []);

  if (error) return <div className="text-red text-[13px]">{error}</div>;
  if (!data) return <div className="text-steel text-[13px]">Cargando…</div>;

  return (
    <div>
      <div className="text-[12.5px] text-steel mb-3">
        Cómo se están vendiendo los productos de <b className="text-ink">Importadora Shanghai</b> en cada tienda. Sale solo de las guías que
        INVESTOCK sube en cada corte: cada barra es una semana (lunes a domingo) y cuenta los pedidos de ese producto.
        {data.historyStart && <> Hay datos desde el {fmtDay(data.historyStart)}.</>} Si un producto está en 🔴 o 🟡, pídanle a la tienda que le haga pauta.
      </div>

      {data.unlinked.length > 0 && <UnlinkedBox items={data.unlinked} stores={data.storeOptions} canLink={data.canLink} onDone={load} />}

      {data.stores.length === 0 && <div className="text-steel text-[13px]">Todavía no hay tiendas para seguir.</div>}

      {data.stores.map((s) => {
        const counts = { QUIETO: 0, BAJANDO: 0, NUEVO: 0, VENDIENDO: 0 } as Record<Status, number>;
        for (const p of s.products) counts[p.status]++;
        return (
          <div key={s.id} className="bg-surface border border-rule rounded-md p-3 mb-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
              <div>
                <div className="text-[15px] font-bold text-ink">🏬 {s.name}</div>
                {s.labelSender && <div className="text-[11.5px] text-steel">En la etiqueta de la guía sale como «{s.labelSender}»</div>}
              </div>
              <div className="text-[12px] text-steel">
                {s.products.length} producto{s.products.length === 1 ? "" : "s"}
                {counts.QUIETO > 0 && <> · <span className="text-red font-semibold">🔴 {counts.QUIETO}</span></>}
                {counts.BAJANDO > 0 && <> · <span className="text-amber font-semibold">🟡 {counts.BAJANDO}</span></>}
                {counts.VENDIENDO > 0 && <> · <span className="text-green font-semibold">🟢 {counts.VENDIENDO}</span></>}
                {counts.NUEVO > 0 && <> · 🔵 {counts.NUEVO}</>}
              </div>
            </div>
            {s.products.length === 0 ? (
              <div className="text-steel text-[12.5px] py-2">Todavía no hay productos vinculados a esta tienda.</div>
            ) : (
              s.products.map((p) => <ProductRow key={p.code} p={p} historyStart={data.historyStart} />)
            )}
          </div>
        );
      })}

      <div className="text-[11.5px] text-steel">
        🔴 Quieto: 7 días sin pedidos · 🟡 Bajando: en los últimos 7 días vendió menos de la mitad de su promedio semanal · 🔵 Nuevo: todavía no hay
        semanas anteriores para comparar · 🟢 Vendiendo: va normal.
      </div>
    </div>
  );
}
