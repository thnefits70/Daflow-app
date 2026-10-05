"use client";

import { useEffect, useState } from "react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { PriceCalculator } from "@/components/marketanalysis/PriceCalculator";

type Status = "preguntar_proveedor" | "urgente" | "pronto" | "sin_proveedor" | "descartado" | "no_sale" | "en_compra";
type DiscardInfo = { id: string; reason: string; reasonLabel: string; note: string | null; byName: string | null; at: string };
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
  supplierOut: { reportId: string; since: string; askAt: string } | null;
  thisWeek: boolean;
  discard: DiscardInfo | null;
  discardReturned: (DiscardInfo & { why: "urgente" | "vencido" }) | null;
};
type NewProduct = { proposalId: string; code: string; name: string; photo: string | null; readyToBuyAt: string };
type Data = { windowDays: number; hot: Row[]; cold: Row[]; newProducts: NewProduct[]; coldNewProducts?: NewProduct[]; audiences: ("hot" | "cold" | "escalation")[]; canReportStockout: boolean; canDiscard: boolean; countPausedUntil: string | null; canUseCalculator?: boolean };

const GROUPS: { status: Status; title: string; hint: string; tone: string }[] = [
  {
    status: "preguntar_proveedor",
    title: "🔔 ¿El proveedor ya lo tiene?",
    hint: "Hace 15 días marcaste que ningún proveedor lo tenía. Pregúntale y responde aquí",
    tone: "text-amber",
  },
  { status: "urgente", title: "🔴 Urgente", hint: "Se acaba antes de que el proveedor pueda traerlo: 15 días o menos si es de CHEN, 7 días o menos con los demás", tone: "text-red" },
  { status: "pronto", title: "🟡 Pronto", hint: "Se vende, pero todavía alcanza para más tiempo del que tarda el proveedor", tone: "text-amber" },
  {
    status: "sin_proveedor",
    title: "🚫 Ningún proveedor lo tiene",
    hint: "No te llegan avisos de estos productos. Cada 15 días se te pregunta si el proveedor ya lo tiene",
    tone: "text-steel",
  },
  {
    status: "descartado",
    title: "🗑️ No hace falta comprarlos",
    hint: "Se descartaron con un motivo. Vuelven solos a los 30 días, o antes si estaban en \"pronto\" y se ponen urgentes",
    tone: "text-steel",
  },
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

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-EC", { day: "numeric", month: "short", timeZone: "America/Guayaquil" });
}

// Pedido del usuario 2026-10-02: motivos fijos + "Otro" con descripción.
const DISCARD_REASONS: { key: string; label: string }[] = [
  { key: "NO_DEMAND", label: "No hay demanda del producto" },
  { key: "NO_SALES", label: "El producto ya no tiene ventas" },
  { key: "OTHER", label: "Otro motivo" },
];

// "No hace falta comprarlo" con doble confirmación: primero el motivo, después
// una segunda pantalla "¿Estás seguro?" para que no sea un clic por error.
function DiscardForm({ r, onDone, onCancel }: { r: Row; onDone: () => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = DISCARD_REASONS.find((x) => x.key === reason)?.label ?? "";
  const canNext = !!reason && (reason !== "OTHER" || note.trim().length >= 5);
  const daysTxt = r.daysLeft === null ? "" : r.daysLeft < 1 ? " y se acaba hoy" : ` y alcanza para ${Math.floor(r.daysLeft)} días`;

  function submit() {
    setBusy(true);
    setError(null);
    fetch("/api/purchase-suggestions/discard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogItemId: r.catalogItemId, reason, note: note.trim() || null }),
    })
      .then((res) => res.json().then((j) => ({ ok: res.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) setError(j.error ?? "No se pudo guardar.");
        else onDone();
      })
      .catch(() => setError("No se pudo guardar."))
      .finally(() => setBusy(false));
  }

  if (step === "confirm") {
    return (
      <div className="mt-2 bg-red/10 border border-red/40 rounded-md p-2.5">
        <div className="text-[12.5px] font-bold text-red">¿Estás seguro de que NO hace falta comprar {r.name}?</div>
        <div className="text-[12px] text-steel mt-1">
          Quedan {r.stock}
          {daysTxt}
          {r.status === "urgente" ? " — está URGENTE" : ""}. Motivo: <b className="text-ink">{label}</b>
          {note.trim() ? ` — ${note.trim()}` : ""}. Le llega al líder de Análisis de Mercado y al administrador.
        </div>
        {error && <div className="text-[11.5px] text-red mt-1">{error}</div>}
        <div className="flex flex-wrap gap-1.5 mt-2">
          <button type="button" disabled={busy} onClick={submit} className="rounded bg-red px-2.5 py-1.5 text-[11.5px] font-bold text-white cursor-pointer disabled:opacity-50">
            {busy ? "Guardando…" : "Sí, no hace falta comprarlo"}
          </button>
          <button type="button" disabled={busy} onClick={() => setStep("form")} className="rounded border border-rule px-2.5 py-1.5 text-[11.5px] text-steel cursor-pointer">
            Volver
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-2 bg-surface border border-rule rounded-md p-2.5">
      <div className="text-[12px] font-semibold text-ink mb-1.5">¿Por qué no hace falta comprarlo?</div>
      <div className="flex flex-wrap gap-1.5">
        {DISCARD_REASONS.map((x) => (
          <button
            key={x.key}
            type="button"
            onClick={() => setReason(x.key)}
            className={`rounded-full border px-2.5 py-1 text-[11.5px] cursor-pointer ${reason === x.key ? "border-teal bg-teal/15 text-teal font-semibold" : "border-rule text-steel hover:text-ink"}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder={reason === "OTHER" ? "Describe por qué (obligatorio)" : "Detalle (opcional)"}
        className="w-full mt-2 rounded border border-rule bg-surface2 px-2 py-1.5 text-[12px] text-ink"
      />
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        <button type="button" disabled={!canNext} onClick={() => setStep("confirm")} className="rounded bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-white cursor-pointer disabled:opacity-50">
          Continuar
        </button>
        <button type="button" onClick={onCancel} className="rounded border border-rule px-2.5 py-1.5 text-[11.5px] text-steel cursor-pointer">
          Cancelar
        </button>
      </div>
    </div>
  );
}

function RowLine({ r, canReportStockout, canDiscard, isCold, onChanged }: { r: Row; canReportStockout: boolean; canDiscard: boolean; isCold: boolean; onChanged: () => void }) {
  const [discarding, setDiscarding] = useState(false);
  function undo() {
    if (!r.discard || !window.confirm(`¿Volver a poner ${r.name} en la lista de compras frías?`)) return;
    fetch(`/api/purchase-suggestions/discard/${r.discard.id}/undo`, { method: "POST" }).then(() => onChanged());
  }
  const days = fmtDaysLeft(r.daysLeft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pedido de Jariel 2026-10-01: un clic para responder si el proveedor ya lo tiene.
  function answer(a: "not_yet" | "has_it") {
    if (!r.supplierOut) return;
    setBusy(true);
    setError(null);
    fetch(`/api/supplier-stockout-reports/${r.supplierOut.reportId}/supplier-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: a }),
    })
      .then((res) => res.json().then((j) => ({ ok: res.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) setError(j.error ?? "No se pudo guardar.");
        else onChanged();
      })
      .catch(() => setError("No se pudo guardar."))
      .finally(() => setBusy(false));
  }
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
        {r.thisWeek && <div className="text-[11.5px] text-amber font-semibold mt-0.5">Comprar o descartar esta semana</div>}
        {r.escalated && <div className="text-[11.5px] text-red font-semibold mt-0.5">Urgente hace {isCold ? 7 : 3} días o más sin comprar — ya se avisó a Daniel</div>}
        {r.discard && (
          <div className="text-[11.5px] text-steel mt-0.5">
            Descartado el {fmtDate(r.discard.at)}
            {r.discard.byName ? ` por ${r.discard.byName}` : ""}: {r.discard.reasonLabel}
            {r.discard.note ? ` — ${r.discard.note}` : ""}
          </div>
        )}
        {r.discardReturned && (
          <div className="text-[11.5px] text-amber mt-0.5">
            Se descartó el {fmtDate(r.discardReturned.at)} ({r.discardReturned.reasonLabel}
            {r.discardReturned.note ? ` — ${r.discardReturned.note}` : ""}). Volvió porque {r.discardReturned.why === "urgente" ? "se puso urgente" : "pasaron 30 días"}.
          </div>
        )}
        {discarding && (
          <DiscardForm
            r={r}
            onCancel={() => setDiscarding(false)}
            onDone={() => {
              setDiscarding(false);
              onChanged();
            }}
          />
        )}
        {r.supplierOut && (
          <div className="text-[11.5px] text-steel mt-0.5">
            Sin proveedor desde el {fmtDate(r.supplierOut.since)}
            {r.status === "sin_proveedor" ? ` · se te vuelve a preguntar el ${fmtDate(r.supplierOut.askAt)}` : ""}
          </div>
        )}
        {error && <div className="text-[11.5px] text-red mt-0.5">{error}</div>}
      </div>
      {canDiscard && isCold && !discarding && (r.status === "urgente" || r.status === "pronto") && (
        <button
          type="button"
          onClick={() => setDiscarding(true)}
          className="shrink-0 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold text-steel hover:text-red hover:border-red"
        >
          No hace falta comprarlo
        </button>
      )}
      {canDiscard && r.discard && (
        <button type="button" onClick={undo} className="shrink-0 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold text-steel hover:text-ink hover:border-teal">
          Volver a la lista
        </button>
      )}
      {canReportStockout && r.status === "preguntar_proveedor" && r.supplierOut && (
        <div className="shrink-0 flex flex-col sm:flex-row gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => answer("not_yet")}
            className="rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold text-steel hover:text-ink hover:border-teal disabled:opacity-50"
          >
            Todavía no le llega
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => answer("has_it")}
            className="rounded border border-teal px-2.5 py-1.5 text-[11.5px] font-semibold text-teal hover:bg-teal/10 disabled:opacity-50"
          >
            Ya lo tiene
          </button>
        </div>
      )}
      {canReportStockout && r.status !== "en_compra" && !r.supplierOut && (
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

function List({
  title,
  sub,
  rows,
  newProducts,
  open,
  canReportStockout,
  canDiscard = false,
  isCold = false,
  onChanged,
}: {
  title: string;
  sub: string;
  rows: Row[];
  newProducts?: NewProduct[];
  open: boolean;
  canReportStockout: boolean;
  canDiscard?: boolean;
  isCold?: boolean;
  onChanged: () => void;
}) {
  const [showNoSale, setShowNoSale] = useState(false);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const week = isCold ? rows.filter((r) => r.thisWeek).length : 0;
  return (
    <details open={open} className="bg-surface border border-rule rounded-md mb-4">
      <summary className="cursor-pointer px-4 py-3 text-[14px] font-bold text-ink">
        {title} <span className="text-[12px] font-normal text-steel">· {sub}</span>
      </summary>
      <div className="px-4 pb-4">
        {/* Pedido del usuario 2026-10-02: la lista de Nairoby es semanal. */}
        {isCold && (
          <div className="mt-2 text-[12px] text-steel bg-amber/10 border border-amber/30 rounded-md px-2.5 py-1.5">
            Esta semana: <b className="text-ink">{week} producto{week === 1 ? "" : "s"}</b> por comprar o descartar (urgentes y los que se vuelven urgentes antes del
            próximo lunes). El aviso llega los lunes; esta lista se queda en Inicio toda la semana.
          </div>
        )}
        {GROUPS.map((g) => {
          const list = rows.filter((r) => r.status === g.status);
          if (list.length === 0) return null;
          const collapsed = (g.status === "no_sale" && !showNoSale) || (g.status === "descartado" && !showDiscarded);
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
                {g.status === "descartado" && (
                  <button type="button" className="text-[12px] text-teal cursor-pointer" onClick={() => setShowDiscarded((v) => !v)}>
                    {showDiscarded ? "Ocultar" : "Ver"}
                  </button>
                )}
              </div>
              <div className="text-[11.5px] text-steel mb-1.5">{g.hint}</div>
              {!collapsed && (
                <div className="bg-surface2 border border-rule rounded-md">
                  {list.map((r) => (
                    <RowLine key={r.catalogItemId} r={r} canReportStockout={canReportStockout} canDiscard={canDiscard} isCold={isCold} onChanged={onChanged} />
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
  const hot = <List key="hot" title="🔥 Compras calientes" sub="30 unidades o menos · Jariel" rows={data.hot} newProducts={data.newProducts} open={!onlyCold} canReportStockout={data.canReportStockout} onChanged={load} />;
  const cold = <List key="cold" title="❄️ Compras frías" sub="31 a 60 unidades · Nairoby" rows={data.cold} newProducts={data.coldNewProducts} open={!onlyHot} canReportStockout={data.canReportStockout} canDiscard={data.canDiscard} isCold onChanged={load} />;

  return (
    <div>
      {/* Pedido del usuario 2026-10-02: conteo físico del 5 al 8 de octubre. */}
      {data.countPausedUntil && (
        <div className="bg-amber/10 border border-amber/40 rounded-md px-3 py-2 text-[12px] text-steel mb-3">
          <b className="text-amber">Conteo físico en curso.</b> Hasta que termine, el stock puede no ser real: no se mandan avisos de compras y esta lista no sale en Inicio.
          Los avisos vuelven el {fmtDate(data.countPausedUntil)} a las 8:00.
        </div>
      )}
      <div className="bg-teal/10 border border-teal/30 rounded-md px-3 py-2 text-[12px] text-steel mb-4">
        Cuánto se vende sale de los pedidos de Dropi que sube Daniel y de las ventas externas de los últimos{" "}
        <b className="text-ink">{days} día{days === 1 ? "" : "s"}</b>
        {days < 30 ? " (los pedidos se guardan desde el 21 de septiembre; cada día que pasa el cálculo es más preciso)" : ""}. Los combos cuentan como venta de cada producto que los forma.
      </div>
      {/* Pedido del usuario 2026-10-05: Nairoby necesita la calculadora de Análisis de Mercado para sus compras frías. */}
      {data.canUseCalculator && <PriceCalculator />}
      {hotFirst ? [hot, cold] : [cold, hot]}
    </div>
  );
}
