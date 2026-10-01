"use client";

import { useEffect, useState } from "react";
import { CatalogCode } from "@/components/shared/CatalogCode";

type Status = "urgente" | "pronto" | "no_sale" | "en_compra";
type Row = {
  catalogItemId: string;
  name: string;
  justCode: string | null;
  photo: string | null;
  stock: number;
  sold: number;
  perDay: number;
  daysLeft: number | null;
  status: Status;
  openPurchase: { code: string | null; quantity: number } | null;
  escalated: boolean;
  supplierName: string | null;
  urgentDays: number;
  suggestedQty: number | null;
};
type NewProduct = { proposalId: string; code: string; name: string; photo: string | null; readyToBuyAt: string };
type Data = { windowDays: number; hot: Row[]; cold: Row[]; newProducts: NewProduct[]; audiences: ("hot" | "cold" | "escalation")[]; canReportStockout: boolean };

const GROUPS: { status: Status; title: string; hint: string; tone: string }[] = [
  { status: "urgente", title: "🔴 Urgente", hint: "Se acaba antes de que el proveedor pueda traerlo: 15 días o menos si es de CHEN, 7 días o menos con los demás", tone: "text-red" },
  { status: "pronto", title: "🟡 Pronto", hint: "Se vende, pero todavía alcanza para más tiempo del que tarda el proveedor", tone: "text-amber" },
  { status: "en_compra", title: "🛒 Ya en compra", hint: "Ya hay una compra abierta — no hace falta pedirlo otra vez", tone: "text-teal" },
  { status: "no_sale", title: "⚪ No sale", hint: "Tiene poco stock, pero no se vendió nada. Revisar antes de comprar", tone: "text-steel" },
];

function fmtPerDay(n: number) {
  if (n === 0) return "no salió nada";
  if (n < 1) return `sale ~${Math.round(n * 7)} por semana`;
  return `sale ~${n < 10 ? n.toFixed(1).replace(".0", "") : Math.round(n)} por día`;
}

function fmtDaysLeft(d: number | null) {
  if (d === null) return null;
  if (d < 1) return "se acaba hoy";
  const n = Math.floor(d);
  return `alcanza para ${n} día${n === 1 ? "" : "s"}`;
}

// Pedido de Jariel 2026-09-29: si ningún proveedor lo tiene, un clic lo lleva
// a Análisis de Mercado → Sin stock de proveedor con el producto ya elegido.
function stockoutUrl(catalogItemId: string) {
  return `${window.location.pathname}?tab=analisis-mercado&ptab=sinstock&reportItem=${catalogItemId}`;
}

function RowLine({ r, canReportStockout }: { r: Row; canReportStockout: boolean }) {
  const days = fmtDaysLeft(r.daysLeft);
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-rule last:border-b-0">
      {r.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.photo} alt="" className="w-10 h-10 rounded object-cover bg-cloud shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded bg-cloud shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-ink truncate">{r.name}</div>
        {/* Pedido de Jariel 2026-09-29: el ID para buscarlo más rápido. */}
        {r.justCode && (
          <div className="flex items-center gap-1 text-[12px] text-steel">
            ID <CatalogCode code={r.justCode} size="text-[12px]" />
          </div>
        )}
        <div className="text-[12px] text-steel">
          Quedan <b className="text-ink">{r.stock}</b> · {fmtPerDay(r.perDay)}
          {days && r.status !== "en_compra" ? (
            <>
              {" "}· <b className={r.status === "urgente" ? "text-red" : "text-ink"}>{days}</b>
            </>
          ) : null}
          {r.openPurchase ? ` · compra ${r.openPurchase.code ?? "abierta"} de ${r.openPurchase.quantity} u.` : ""}
        </div>
        {/* Confirmado 2026-10-01 por Daniel: cuánto comprar y con qué proveedor se midió. */}
        {(r.suggestedQty || r.supplierName) && (
          <div className="text-[12px] text-steel">
            {r.suggestedQty ? (
              <>
                Comprar <b className="text-teal">~{r.suggestedQty} u.</b> (para {r.urgentDays} días mientras llega + 1 mes)
              </>
            ) : null}
            {r.suggestedQty && r.supplierName ? " · " : ""}
            {r.supplierName ? `Última compra: ${r.supplierName}` : ""}
          </div>
        )}
        {r.escalated && <div className="text-[11.5px] text-red font-semibold mt-0.5">Urgente hace 3 días o más sin comprar — ya se avisó a Daniel</div>}
      </div>
      {canReportStockout && r.status !== "en_compra" && (
        <a
          href={stockoutUrl(r.catalogItemId)}
          className="shrink-0 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold text-steel hover:text-ink hover:border-teal"
        >
          Ningún proveedor lo tiene
        </a>
      )}
    </div>
  );
}

function List({ title, sub, rows, newProducts, open, canReportStockout }: { title: string; sub: string; rows: Row[]; newProducts?: NewProduct[]; open: boolean; canReportStockout: boolean }) {
  const [showNoSale, setShowNoSale] = useState(false);
  return (
    <details open={open} className="bg-surface border border-rule rounded-md mb-4">
      <summary className="cursor-pointer px-4 py-3 text-[14px] font-bold text-ink">
        {title} <span className="text-[12px] font-normal text-steel">· {sub}</span>
      </summary>
      <div className="px-4 pb-4">
        {GROUPS.map((g) => {
          const list = rows.filter((r) => r.status === g.status);
          if (list.length === 0) return null;
          const collapsed = g.status === "no_sale" && !showNoSale;
          return (
            <div key={g.status} className="mt-3">
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <div className={`text-[13px] font-bold ${g.tone}`}>
                  {g.title} ({list.length})
                </div>
                {g.status === "no_sale" && (
                  <button type="button" className="text-[12px] text-teal cursor-pointer" onClick={() => setShowNoSale((v) => !v)}>
                    {showNoSale ? "Ocultar" : "Ver"}
                  </button>
                )}
              </div>
              <div className="text-[11.5px] text-steel mb-1.5">{g.hint}</div>
              {!collapsed && (
                <div className="bg-surface2 border border-rule rounded-md">
                  {list.map((r) => (
                    <RowLine key={r.catalogItemId} r={r} canReportStockout={canReportStockout} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {newProducts && newProducts.length > 0 && (
          <div className="mt-3">
            <div className="text-[13px] font-bold text-teal mb-1.5">🆕 Productos nuevos ({newProducts.length})</div>
            <div className="text-[11.5px] text-steel mb-1.5">Bryan ya los aprobó y nunca entraron a bodega. Se compran desde Análisis de Mercado → Listo para comprar.</div>
            <div className="bg-surface2 border border-rule rounded-md">
              {newProducts.map((p) => (
                <div key={p.proposalId} className="flex items-center gap-3 px-3 py-2.5 border-b border-rule last:border-b-0">
                  {p.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.photo} alt="" className="w-10 h-10 rounded object-cover bg-cloud shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-cloud shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-ink truncate">{p.name}</div>
                    <div className="text-[12px] text-steel">{p.code}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {rows.length === 0 && (!newProducts || newProducts.length === 0) && <div className="text-[13px] text-steel mt-2">Nada por ahora.</div>}
      </div>
    </details>
  );
}

// "Qué comprar" (confirmado 2026-09-29, idea de Daniel): compras calientes
// (Jariel) y frías (Nairoby), ordenadas por los días que le quedan a cada
// producto según lo que de verdad se vende.
export function PurchaseSuggestionsPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch("/api/purchase-suggestions")
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

  const days = Math.round(data.windowDays);
  // Cada quien ve abierta y primero su propia lista; Daniel y el admin, las dos.
  const onlyCold = data.audiences.includes("cold") && !data.audiences.includes("hot");
  const onlyHot = data.audiences.includes("hot") && !data.audiences.includes("cold");
  const hotFirst = !onlyCold;
  const hot = <List key="hot" title="🔥 Compras calientes" sub="30 unidades o menos · Jariel" rows={data.hot} newProducts={data.newProducts} open={!onlyCold} canReportStockout={data.canReportStockout} />;
  const cold = <List key="cold" title="❄️ Compras frías" sub="31 a 60 unidades · Nairoby" rows={data.cold} open={!onlyHot} canReportStockout={data.canReportStockout} />;

  return (
    <div>
      <div className="bg-teal/10 border border-teal/30 rounded-md px-3 py-2 text-[12px] text-steel mb-4">
        Cuánto se vende sale de los pedidos de Dropi que sube Daniel y de las ventas externas de los últimos{" "}
        <b className="text-ink">{days} día{days === 1 ? "" : "s"}</b>
        {days < 30 ? " (los pedidos se guardan desde el 21 de septiembre; cada día que pasa el cálculo es más preciso)" : ""}. Los combos cuentan como venta de cada producto que los forma.
      </div>
      {hotFirst ? [hot, cold] : [cold, hot]}
    </div>
  );
}
