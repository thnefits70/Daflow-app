"use client";

import { useEffect, useState } from "react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { MIX_MIN_UNITS, splitByVariant } from "@/lib/variantMix";

type Variant = { label: string; units: number; pct: number; trend: "up" | "down" | null };
type Product = { catalogItemId: string; name: string; justCode: string | null; photo: string | null; totalUnits: number; variantUnits: number; variants: Variant[] };
type Data = { days: number; since: string; products: Product[] };

const PERIODS = [
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
  { days: 90, label: "90 días" },
];

function mixOf100(variants: Variant[]): string {
  return splitByVariant(100, variants).map((m) => `${m.label} ${m.qty}`).join(" · ");
}

function ProductCard({ p }: { p: Product }) {
  const top = p.variants[0]?.units ?? 1;
  const unread = p.totalUnits - p.variantUnits;
  return (
    <div className="bg-surface border border-rule rounded-md p-3 mb-3">
      <div className="flex items-start gap-3">
        {p.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img loading="lazy" decoding="async" src={p.photo} alt="" className="w-12 h-12 rounded object-cover bg-cloud shrink-0" />
        ) : (
          <div className="w-12 h-12 rounded bg-cloud shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold text-ink">{p.name}</div>
          {p.justCode && (
            <div className="flex items-center gap-1 text-[12px] text-steel">
              ID <CatalogCode code={p.justCode} size="text-[12px]" />
            </div>
          )}
          <div className="text-[12.5px] text-ink mt-0.5">
            <b>{p.totalUnits}</b> vendidas
            {unread > 0 && <span className="text-steel"> · {unread} sin color/talla en la guía</span>}
          </div>
        </div>
      </div>
      <div className="mt-2.5 space-y-1.5">
        {p.variants.map((v) => (
          <div key={v.label} className="flex items-center gap-2 text-[12.5px]">
            <div className="w-36 sm:w-48 shrink-0 truncate text-ink" title={v.label}>
              {v.label}
            </div>
            <div className="flex-1 h-2.5 rounded bg-cloud overflow-hidden">
              <div className="h-full bg-teal rounded" style={{ width: `${Math.max(2, (v.units / top) * 100)}%` }} />
            </div>
            <div className="w-24 shrink-0 text-right text-ink">
              <b>{v.units}</b> <span className="text-steel">({v.pct}%)</span>
            </div>
            <div className="w-20 shrink-0 text-[11.5px] font-semibold">
              {v.trend === "up" && <span className="text-teal">↑ subiendo</span>}
              {v.trend === "down" && <span className="text-red">↓ bajando</span>}
            </div>
          </div>
        ))}
      </div>
      {p.variantUnits >= MIX_MIN_UNITS && (
        <div className="mt-2.5 rounded-md border border-rule bg-surface2 px-3 py-2 text-[12.5px] text-ink">
          👉 Si compras 100: <b>{mixOf100(p.variants)}</b>
        </div>
      )}
    </div>
  );
}

// "Ventas por variante" (etapa 1, pedido del usuario 2026-10-05): qué color /
// talla de cada producto se vende más, leído de las guías de los cortes.
export function VariantSalesPanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`/api/variant-sales?days=${days}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!alive) return;
        if (!ok) setError(j.error ?? "No se pudo cargar.");
        else {
          setError(null);
          setData(j);
        }
      })
      .catch(() => alive && setError("No se pudo cargar."));
    return () => {
      alive = false;
    };
  }, [days]);

  const term = q.trim().toLowerCase();
  const shown = data?.products.filter((p) => !term || p.name.toLowerCase().includes(term) || (p.justCode ?? "").includes(term)) ?? [];

  return (
    <div>
      <div className="bg-teal/10 border border-teal/30 rounded-md px-3 py-2 text-[12px] text-steel mb-4">
        Qué color o talla de cada producto se vende más, según las guías de los cortes (desde el <b className="text-ink">26 sep 2026</b>). Son unidades despachadas;
        las devoluciones no se restan. <b className="text-ink">↑ / ↓</b> compara la mitad reciente del período con la anterior. Los paquetes (&quot;Paquete de 2&quot;)
        no son variantes y no entran.
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {PERIODS.map((p) => (
          <button
            key={p.days}
            type="button"
            onClick={() => setDays(p.days)}
            className={`rounded-full border px-3 py-1 text-[12px] font-semibold cursor-pointer ${days === p.days ? "bg-teal text-white border-teal" : "border-rule text-steel hover:text-ink"}`}
          >
            {p.label}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar producto o ID"
          className="ml-auto w-full sm:w-56 rounded border border-rule bg-surface px-2 py-1.5 text-[13px] text-ink"
        />
      </div>
      {error && <div className="text-red text-[13px]">{error}</div>}
      {!error && !data && <div className="text-steel text-[13px]">Cargando…</div>}
      {data && shown.length === 0 && (
        <div className="text-[13px] text-steel">{term ? "Ningún producto con ese nombre." : "Todavía no hay productos con colores o tallas en este período."}</div>
      )}
      {shown.map((p) => (
        <ProductCard key={p.catalogItemId} p={p} />
      ))}
    </div>
  );
}
