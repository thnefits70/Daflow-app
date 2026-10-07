"use client";

import { useEffect, useMemo, useState } from "react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { PurchaseSupplierPicker } from "@/components/purchases/PurchaseSupplierPicker";
import { computeRepurchase, repurchaseVerdictText, REPURCHASE_VERDICT_LABELS, type RepurchaseCalc, type RepurchaseVerdict } from "@/lib/repurchasePricing";

// Recompras (pedido del usuario 2026-10-06). Toda recompra — calientes de
// Jariel y frías de Nairoby — se analiza acá y la aprueba Bryan Ríos antes de
// pedir la compra. Pantalla guiada en 3 pasos: elegir el producto, poner lo
// de hoy (proveedor y competencia) y ver el resultado antes de enviar.

type ItemOption = { id: string; name: string; justCode: string | null; photo: string | null };
type Params = { insuranceRatePercent: number; fulfillmentCost: number; marginPercent: number };
type Analysis = {
  item: ItemOption;
  suppliers: { supplierId: string; supplierName: string; latest: number; latestDate: string; latestCode: string | null; count: number }[];
  last: { unitCost: number; supplierName: string; date: string; code: string | null } | null;
  publishedDropiPrice: number | null;
  params: Params;
  competitor: { id: string | null; price: number | null; source: string } | null;
  stock: number;
  sold: number;
  windowDays: number;
  perDay: number;
  daysLeft: number | null;
  suggestedQty: number | null;
  audience: "HOT" | "COLD";
  blocker: string | null;
  stockCover: { message: string; needsReason: boolean } | null;
  history: Row[];
};
type State = "PENDING_APPROVAL" | "APPROVED" | "EXPIRED" | "REJECTED" | "USED" | "CANCELLED";
type Row = {
  id: string;
  code: string;
  catalogItemId: string;
  itemName: string;
  justCode: string | null;
  photo: string | null;
  supplierId: string;
  supplierName: string;
  unitCost: number;
  freightTotal: number | null;
  quantity: number;
  approvedQuantity: number | null;
  competitorId: string | null;
  competitorPrice: number | null;
  noCompetitorNote: string | null;
  lastUnitCost: number | null;
  lastSupplierName: string | null;
  lastPurchaseAt: string | null;
  lastCompetitorPrice: number | null;
  lastMarginAtCompetitor: number | null;
  publishedDropiPrice: number | null;
  newDropiPrice: number;
  marginAtCompetitor: number | null;
  maxSupplierCost: number | null;
  marginPercent: number;
  verdict: RepurchaseVerdict;
  verdictLabel: string;
  stockAtRequest: number;
  soldLast30: number;
  daysLeft: number | null;
  audience: "HOT" | "COLD";
  note: string | null;
  state: State;
  requestedById: string | null;
  requestedByName: string | null;
  requestedAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  approvalExpiresAt: string | null;
  usedPurchaseCode: string | null;
  usedAt: string | null;
  waitingTooLong: boolean;
  stockStillCovered: boolean;
};
type Data = { pending: Row[]; history: Row[]; canRequest: boolean; canDecide: boolean; canViewAll: boolean; userId: string };

const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `$${n.toFixed(2)}`);
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toFixed(1)}%`);
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-EC", { day: "numeric", month: "short", timeZone: "America/Guayaquil" });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Guayaquil" });
}
function daysLeftText(d: number | null) {
  if (d === null) return "no se vendió nada";
  if (d < 1) return "se acaba hoy";
  return `alcanza ${Math.floor(d)} día${Math.floor(d) === 1 ? "" : "s"}`;
}

const VERDICT_TONE: Record<RepurchaseVerdict, string> = {
  GREEN: "bg-teal/10 border-teal/40 text-teal",
  YELLOW: "bg-amber/10 border-amber/40 text-amber",
  RED: "bg-red/10 border-red/40 text-red",
  NO_COMPETITOR: "bg-cloud border-rule text-steel",
};

const STATE_LABEL: Record<State, { text: string; tone: string }> = {
  PENDING_APPROVAL: { text: "Esperando a Bryan", tone: "text-amber" },
  APPROVED: { text: "Aprobada — pide la compra", tone: "text-teal" },
  EXPIRED: { text: "Aprobación vencida", tone: "text-steel" },
  REJECTED: { text: "Rechazada", tone: "text-red" },
  USED: { text: "Comprada", tone: "text-teal" },
  CANCELLED: { text: "Retirada", tone: "text-steel" },
};

function Thumb({ src }: { src: string | null }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img loading="lazy" decoding="async" src={src} alt="" className="w-11 h-11 rounded object-cover bg-cloud shrink-0" />
  ) : (
    <div className="w-11 h-11 rounded bg-cloud shrink-0" />
  );
}

// Tabla "Última compra vs Hoy" — la misma para quien envía (mientras escribe)
// y para Bryan (con lo que se guardó al enviar).
function CompareTable(p: {
  lastLabel: string;
  lastBodegaCost: number | null;
  todayBodegaCost: number | null;
  todaySupplierCost: number | null;
  todayFreightPerUnit: number | null;
  publishedDropiPrice: number | null;
  newDropiPrice: number | null;
  lastCompetitorPrice: number | null;
  todayCompetitorPrice: number | null;
  lastMargin: number | null;
  todayMargin: number | null;
  marginPercent: number;
}) {
  const marginTone = (m: number | null) => (m === null ? "" : m >= p.marginPercent ? "text-teal" : m > 0 ? "text-amber" : "text-red");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px] border-collapse">
        <thead>
          <tr className="text-steel text-left">
            <th className="py-1.5 pr-2 font-semibold"></th>
            <th className="py-1.5 px-2 font-semibold">{p.lastLabel}</th>
            <th className="py-1.5 pl-2 font-semibold">Hoy</th>
          </tr>
        </thead>
        <tbody className="text-ink">
          <tr className="border-t border-rule">
            <td className="py-1.5 pr-2 text-steel">Costo puesto en bodega (proveedor + flete)</td>
            <td className="py-1.5 px-2">{money(p.lastBodegaCost)}</td>
            <td className="py-1.5 pl-2 font-semibold">
              {money(p.todayBodegaCost)}
              {p.todaySupplierCost !== null && p.todayFreightPerUnit ? (
                <span className="block text-[11px] font-normal text-steel">
                  {money(p.todaySupplierCost)} + {money(p.todayFreightPerUnit)} de flete
                </span>
              ) : null}
              {p.lastBodegaCost !== null && p.todayBodegaCost !== null && Math.abs(p.todayBodegaCost - p.lastBodegaCost) >= 0.01 ? (
                <span className={`block text-[11px] font-normal ${p.todayBodegaCost > p.lastBodegaCost ? "text-red" : "text-teal"}`}>
                  {p.todayBodegaCost > p.lastBodegaCost ? "subió" : "bajó"} {money(Math.abs(p.todayBodegaCost - p.lastBodegaCost))}
                </span>
              ) : null}
            </td>
          </tr>
          <tr className="border-t border-rule">
            <td className="py-1.5 pr-2 text-steel">Nuestro precio Dropi</td>
            <td className="py-1.5 px-2">{money(p.publishedDropiPrice)}</td>
            <td className="py-1.5 pl-2 font-semibold">{money(p.newDropiPrice)}</td>
          </tr>
          <tr className="border-t border-rule">
            <td className="py-1.5 pr-2 text-steel">Competencia</td>
            <td className="py-1.5 px-2">{money(p.lastCompetitorPrice)}</td>
            <td className="py-1.5 pl-2 font-semibold">{money(p.todayCompetitorPrice)}</td>
          </tr>
          <tr className="border-t border-rule">
            <td className="py-1.5 pr-2 text-steel">Margen vendiendo 1¢ más barato que la competencia</td>
            <td className={`py-1.5 px-2 font-semibold ${marginTone(p.lastMargin)}`}>{pct(p.lastMargin)}</td>
            <td className={`py-1.5 pl-2 font-bold ${marginTone(p.todayMargin)}`}>{pct(p.todayMargin)}</td>
          </tr>
        </tbody>
      </table>
      <div className="text-[11px] text-steel mt-1">Margen mínimo pedido para este producto: {p.marginPercent}%.</div>
    </div>
  );
}

function VerdictBox({ calc, competitorPrice, marginPercent }: { calc: RepurchaseCalc; competitorPrice: number | null; marginPercent: number }) {
  return (
    <div className={`border rounded-md px-3 py-2.5 ${VERDICT_TONE[calc.verdict]}`}>
      <div className="text-[13.5px] font-bold">{REPURCHASE_VERDICT_LABELS[calc.verdict]}</div>
      <div className="text-[12.5px] text-ink mt-0.5">{repurchaseVerdictText(calc, competitorPrice, marginPercent)}</div>
      {calc.maxSupplierCost !== null && (
        <div className="text-[12px] text-steel mt-1">
          Precio máximo a pagarle al proveedor por unidad: <b className="text-ink">{money(calc.maxSupplierCost)}</b>
        </div>
      )}
    </div>
  );
}

// ---- Paso 1: elegir el producto ------------------------------------------------

function ItemSearch({ onPick }: { onPick: (i: ItemOption) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ItemOption[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`/api/repurchase-reviews/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => (r.ok ? r.json() : []))
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const shown = q.trim().length < 2 ? [] : results;
  return (
    <div>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Escribe el nombre o el ID de Dropi del producto"
        className="w-full rounded border border-rule bg-surface px-3 py-2 text-[13px]"
      />
      <div className="text-[11.5px] text-steel mt-1">Solo salen productos que ya estuvieron en bodega. Un producto nuevo se propone en Análisis de Mercado → Proponer.</div>
      {loading && <div className="text-[12px] text-steel mt-2">Buscando…</div>}
      {shown.length > 0 && (
        <div className="mt-2 bg-surface2 border border-rule rounded-md max-h-80 overflow-y-auto">
          {shown.map((i) => (
            <button key={i.id} type="button" onClick={() => onPick(i)} className="w-full flex items-center gap-3 px-3 py-2 border-b border-rule last:border-b-0 text-left hover:bg-teal/5 cursor-pointer">
              <Thumb src={i.photo} />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-ink truncate">{i.name}</div>
                {i.justCode && (
                  <div className="flex items-center gap-1 text-[12px] text-steel">
                    ID <CatalogCode code={i.justCode} size="text-[12px]" />
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
      {!loading && q.trim().length >= 2 && shown.length === 0 && <div className="text-[12px] text-steel mt-2">No se encontró ninguna recompra con ese nombre o ID.</div>}
    </div>
  );
}

// Buscar un proveedor al que nunca se le compró este producto. Pedido del
// usuario 2026-10-07: si no está registrado, se registra aquí mismo (mismo
// formulario que Solicitar) y queda en la lista de Proveedores — es la misma
// tabla, nunca un registro aparte.
function OtherSupplierSearch({ onPick }: { onPick: (s: { id: string; name: string }) => void }) {
  return (
    <div className="mt-2">
      <PurchaseSupplierPicker type="SUPPLIER" value={null} onChange={(s) => s && onPick({ id: s.id, name: s.name })} label="Buscar otro proveedor o registrar uno nuevo" />
      <div className="text-[11px] text-steel mt-1">Si no está registrado, pulsa &quot;Registrar proveedor nuevo&quot;: queda guardado también en Proveedores.</div>
    </div>
  );
}

// ---- Pasos 2 y 3: lo de hoy + resultado ------------------------------------------

function Analyzer({ itemId, onBack, onSent }: { itemId: string; onBack: () => void; onSent: (code: string) => void }) {
  const [a, setA] = useState<Analysis | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [supplier, setSupplier] = useState<{ id: string; name: string } | null>(null);
  const [unitCost, setUnitCost] = useState("");
  const [quantity, setQuantity] = useState("");
  const [chargesFreight, setChargesFreight] = useState<boolean | null>(null);
  const [freight, setFreight] = useState("");
  const [competitorId, setCompetitorId] = useState("");
  const [competitorPrice, setCompetitorPrice] = useState("");
  const [noCompetitor, setNoCompetitor] = useState(false);
  const [noCompetitorNote, setNoCompetitorNote] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/repurchase-reviews/analysis?catalogItemId=${encodeURIComponent(itemId)}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) {
          setLoadError(j.error ?? "No se pudo cargar.");
          return;
        }
        const an = j as Analysis;
        setA(an);
        if (an.suggestedQty) setQuantity(String(an.suggestedQty));
        if (an.competitor?.id) setCompetitorId(an.competitor.id);
      })
      .catch(() => setLoadError("No se pudo cargar."));
  }, [itemId]);

  const competitorValue = noCompetitor ? null : Number(competitorPrice) > 0 ? Number(competitorPrice) : null;
  const freightValue = chargesFreight ? Number(freight) || 0 : null;
  const calc = useMemo(
    () => (a ? computeRepurchase({ unitCost: Number(unitCost), freightTotal: freightValue, quantity: Number(quantity), competitorPrice: competitorValue, params: a.params }) : null),
    [a, unitCost, freightValue, quantity, competitorValue],
  );
  // La última compra (costo ya con flete) contra la competencia de esa vez.
  const lastCalc = useMemo(
    () => (a?.last ? computeRepurchase({ unitCost: a.last.unitCost, freightTotal: null, quantity: 1, competitorPrice: a.competitor?.price ?? null, params: a.params }) : null),
    [a],
  );

  if (loadError) {
    return (
      <div>
        <div className="text-red text-[13px]">{loadError}</div>
        <button type="button" onClick={onBack} className="mt-2 text-[12px] text-teal cursor-pointer">
          ← Elegir otro producto
        </button>
      </div>
    );
  }
  if (!a) return <div className="text-steel text-[13px]">Cargando lo que sabemos del producto…</div>;

  const missing: string[] = [];
  if (!supplier) missing.push("el proveedor");
  if (!(Number(unitCost) > 0)) missing.push("el precio de hoy del proveedor");
  if (!(Number(quantity) > 0) || !Number.isInteger(Number(quantity))) missing.push("la cantidad");
  if (chargesFreight === null) missing.push("si cobra flete");
  if (chargesFreight && !(Number(freight) > 0)) missing.push("el flete total");
  if (!noCompetitor && !(Number(competitorPrice) > 0)) missing.push("el precio de hoy de la competencia");
  if (noCompetitor && noCompetitorNote.trim().length < 5) missing.push("por qué no hay competencia");
  if (a?.stockCover?.needsReason && note.trim().length < 10) missing.push("el motivo para comprar aunque todavía hay stock");

  function send() {
    if (!supplier) return;
    setBusy(true);
    setError(null);
    fetch("/api/repurchase-reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        catalogItemId: itemId,
        supplierId: supplier.id,
        unitCost: Number(unitCost),
        freightTotal: chargesFreight ? Number(freight) : null,
        quantity: Number(quantity),
        competitorId: noCompetitor ? null : competitorId.trim() || null,
        competitorPrice: noCompetitor ? null : Number(competitorPrice),
        noCompetitorNote: noCompetitor ? noCompetitorNote.trim() : null,
        note: note.trim() || null,
      }),
    })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) {
          setError(j.error ?? "No se pudo enviar.");
          setConfirming(false);
        } else onSent(j.code);
      })
      .catch(() => setError("No se pudo enviar."))
      .finally(() => setBusy(false));
  }

  const knownSuppliers = a.suppliers.slice(0, 4);
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <Thumb src={a.item.photo} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold text-ink">{a.item.name}</div>
          {a.item.justCode && (
            <div className="flex items-center gap-1 text-[12px] text-steel">
              ID <CatalogCode code={a.item.justCode} size="text-[12px]" />
            </div>
          )}
        </div>
        <button type="button" onClick={onBack} className="text-[12px] text-teal cursor-pointer shrink-0">
          Cambiar producto
        </button>
      </div>

      {/* Lo que DAFLOW ya sabe */}
      <div className="bg-cloud border border-rule rounded-md p-3 mb-3 text-[12.5px]">
        <div className="text-[12px] font-bold text-steel uppercase tracking-wide mb-1.5">Lo que ya sabemos</div>
        <div className="text-ink">
          Quedan <b>{a.stock}</b> · se vendieron <b>{a.sold}</b> en {Math.round(a.windowDays)} días · {daysLeftText(a.daysLeft)} ·{" "}
          {a.audience === "HOT" ? "🔥 compra caliente" : "❄️ compra fría"}
        </div>
        {a.suggestedQty ? (
          <div className="text-steel">
            Cantidad sugerida: <b className="text-teal">~{a.suggestedQty} u.</b> (lo que se vende mientras llega + 1 mes, menos lo que queda)
          </div>
        ) : (
          <div className="text-steel">Con lo que queda todavía alcanza: no hay cantidad sugerida.</div>
        )}
        <div className="text-steel">
          Precio en Dropi hoy: <b className="text-ink">{money(a.publishedDropiPrice)}</b>
          {a.competitor?.price ? (
            <>
              {" "}· competencia anotada la última vez: <b className="text-ink">{money(a.competitor.price)}</b>
              {a.competitor.id ? ` (ID ${a.competitor.id})` : ""}
            </>
          ) : (
            " · nunca se anotó la competencia de este producto"
          )}
        </div>
        {a.suppliers.length > 0 ? (
          <div className="mt-1.5">
            <div className="text-steel">Compras anteriores (precio puesto en bodega, ya con flete):</div>
            {a.suppliers.slice(0, 5).map((s) => (
              <div key={s.supplierId} className="text-ink">
                · {s.supplierName}: <b>{money(s.latest)}</b> el {fmtDate(s.latestDate)}
                {s.latestCode ? ` (${s.latestCode})` : ""} · {s.count} compra{s.count === 1 ? "" : "s"}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-steel mt-1">Todavía no hay compras de este producto en DAFLOW (estaba en bodega desde antes).</div>
        )}
        {a.history.length > 0 && (
          <div className="mt-1.5 text-steel">
            Recompras anteriores:{" "}
            {a.history
              .slice(0, 3)
              .map((h) => `${h.code} ${STATE_LABEL[h.state].text.toLowerCase()} (${fmtDate(h.requestedAt)})`)
              .join(" · ")}
          </div>
        )}
      </div>

      {a.blocker ? (
        <div className="bg-red/10 border border-red/40 rounded-md px-3 py-2.5 text-[12.5px] text-red">{a.blocker}</div>
      ) : (
        <>
          {a.stockCover && (
            <div className={`rounded-md px-3 py-2.5 mb-3 text-[12.5px] border ${a.stockCover.needsReason ? "bg-red/10 border-red/40 text-red" : "bg-amber/10 border-amber/40 text-amber"}`}>
              ⚠️ {a.stockCover.message}{" "}
              {a.stockCover.needsReason
                ? "Si de verdad hace falta (ej. temporada), explica el motivo en la nota para Bryan: sin eso no se puede enviar."
                : "Mientras dura el conteo físico solo es un aviso: revisa bien antes de comprar."}
            </div>
          )}
          {/* Paso 2: lo de hoy */}
          <div className="bg-surface border border-rule rounded-md p-3 mb-3">
            <div className="text-[13px] font-bold text-ink mb-0.5">Paso 2 · Lo de hoy</div>
            <div className="text-[12px] text-steel mb-2.5">Pregúntale hoy al proveedor y revisa hoy a la competencia: los precios cambian.</div>

            <div className="text-[12px] font-semibold text-steel mb-1">¿A qué proveedor le vas a comprar?</div>
            <div className="flex flex-wrap gap-1.5">
              {knownSuppliers.map((s) => (
                <button
                  key={s.supplierId}
                  type="button"
                  onClick={() => setSupplier({ id: s.supplierId, name: s.supplierName })}
                  className={`rounded-full border px-2.5 py-1 text-[12px] cursor-pointer ${supplier?.id === s.supplierId ? "border-teal bg-teal/15 text-teal font-semibold" : "border-rule text-steel hover:text-ink"}`}
                >
                  {s.supplierName} · antes {money(s.latest)}
                </button>
              ))}
              {supplier && !knownSuppliers.some((s) => s.supplierId === supplier.id) && (
                <span className="rounded-full border border-teal bg-teal/15 text-teal font-semibold px-2.5 py-1 text-[12px]">{supplier.name}</span>
              )}
            </div>
            <OtherSupplierSearch onPick={setSupplier} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3">
              <div>
                <label className="block text-[12px] font-semibold text-steel mb-1">Precio de hoy por unidad (USD)</label>
                <input type="number" step="0.01" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder={a.last ? `La última vez ${money(a.last.unitCost)}` : "0.00"} className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[13px]" />
                <div className="text-[11px] text-steel mt-0.5">Lo que de verdad pagas por unidad: si cobra IVA aparte, con IVA.</div>
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-steel mb-1">Cantidad a comprar</label>
                <input type="number" step="1" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[13px]" />
                <div className="text-[11px] text-steel mt-0.5">Bryan puede cambiarla al aprobar.</div>
              </div>
            </div>

            <div className="text-[12px] font-semibold text-steel mt-3 mb-1">¿El proveedor cobra el flete aparte?</div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setChargesFreight(false)} className={`rounded border px-2.5 py-1 text-[12px] cursor-pointer ${chargesFreight === false ? "border-teal bg-teal/15 text-teal font-semibold" : "border-rule text-steel"}`}>
                No, el precio ya lo incluye
              </button>
              <button type="button" onClick={() => setChargesFreight(true)} className={`rounded border px-2.5 py-1 text-[12px] cursor-pointer ${chargesFreight ? "border-teal bg-teal/15 text-teal font-semibold" : "border-rule text-steel"}`}>
                Sí, cobra flete
              </button>
            </div>
            {chargesFreight && (
              <input type="number" step="0.01" min="0" value={freight} onChange={(e) => setFreight(e.target.value)} placeholder="Flete total de todo el pedido (USD)" className="mt-1.5 w-full sm:w-1/2 rounded border border-rule bg-surface px-2.5 py-1.5 text-[13px]" />
            )}

            <div className="text-[12px] font-semibold text-steel mt-3 mb-1">Competencia de hoy (Dropi)</div>
            {!noCompetitor && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input value={competitorId} onChange={(e) => setCompetitorId(e.target.value)} placeholder="ID del producto de la competencia" className="rounded border border-rule bg-surface px-2.5 py-1.5 text-[13px]" />
                <input type="number" step="0.01" min="0" value={competitorPrice} onChange={(e) => setCompetitorPrice(e.target.value)} placeholder={a.competitor?.price ? `La última vez ${money(a.competitor.price)}` : "Precio de venta de la competencia"} className="rounded border border-rule bg-surface px-2.5 py-1.5 text-[13px]" />
              </div>
            )}
            <label className="mt-1.5 flex items-center gap-2 text-[12px] text-steel cursor-pointer">
              <input type="checkbox" checked={noCompetitor} onChange={(e) => setNoCompetitor(e.target.checked)} />
              No encontré este producto en la competencia
            </label>
            {noCompetitor && (
              <textarea value={noCompetitorNote} onChange={(e) => setNoCompetitorNote(e.target.value)} rows={2} maxLength={500} placeholder="¿Dónde buscaste y por qué no aparece? (obligatorio)" className="mt-1 w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12.5px]" />
            )}

            <label className="block text-[12px] font-semibold text-steel mt-3 mb-1">Nota para Bryan {a.stockCover?.needsReason ? "(obligatoria: por qué comprar si todavía hay stock)" : "(opcional)"}</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder="Ej.: el proveedor sube el precio la próxima semana" className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12.5px]" />
          </div>

          {/* Paso 3: resultado */}
          <div className="bg-surface border border-rule rounded-md p-3">
            <div className="text-[13px] font-bold text-ink mb-2">Paso 3 · Resultado</div>
            {calc ? (
              <>
                <CompareTable
                  lastLabel={a.last ? `Última compra (${fmtDate(a.last.date)}, ${a.last.supplierName})` : "Última compra"}
                  lastBodegaCost={a.last?.unitCost ?? null}
                  todayBodegaCost={calc.bodegaCost}
                  todaySupplierCost={Number(unitCost)}
                  todayFreightPerUnit={calc.freightPerUnit}
                  publishedDropiPrice={a.publishedDropiPrice}
                  newDropiPrice={calc.newDropiPrice}
                  lastCompetitorPrice={a.competitor?.price ?? null}
                  todayCompetitorPrice={competitorValue}
                  lastMargin={lastCalc?.marginAtCompetitor ?? null}
                  todayMargin={calc.marginAtCompetitor}
                  marginPercent={a.params.marginPercent}
                />
                <div className="mt-2.5">
                  <VerdictBox calc={calc} competitorPrice={competitorValue} marginPercent={a.params.marginPercent} />
                </div>
                {calc.verdict === "RED" && a.audience === "COLD" && (
                  <div className="text-[12px] text-steel mt-1.5">
                    Si no conviene, no hace falta enviarla: en Qué comprar → Compras frías puedes marcarlo &quot;No hace falta comprarlo&quot; con el motivo &quot;La competencia lo tiene más barato&quot;.
                  </div>
                )}
              </>
            ) : (
              <div className="text-[12.5px] text-steel">Pon el precio de hoy y la cantidad para ver la cuenta.</div>
            )}

            {missing.length > 0 && <div className="text-[12px] text-amber mt-2.5">Para enviar a Bryan falta: {missing.join(", ")}.</div>}
            {error && <div className="text-[12.5px] text-red mt-2">{error}</div>}
            {!confirming ? (
              <button
                type="button"
                disabled={missing.length > 0 || !calc}
                onClick={() => setConfirming(true)}
                className="mt-2.5 rounded bg-teal px-3.5 py-2 text-[12.5px] font-bold text-white cursor-pointer disabled:opacity-50"
              >
                Enviar a Bryan
              </button>
            ) : (
              <div className="mt-2.5 bg-teal/10 border border-teal/40 rounded-md p-2.5">
                <div className="text-[12.5px] text-ink">
                  ¿Enviar a Bryan la recompra de <b>{quantity} u.</b> de {a.item.name} a <b>{money(Number(unitCost))}</b> con {supplier?.name}? Hasta que la apruebe no se puede pedir la compra.
                </div>
                <div className="flex gap-1.5 mt-2">
                  <button type="button" disabled={busy} onClick={send} className="rounded bg-teal px-3 py-1.5 text-[12px] font-bold text-white cursor-pointer disabled:opacity-50">
                    {busy ? "Enviando…" : "Sí, enviar"}
                  </button>
                  <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded border border-rule px-3 py-1.5 text-[12px] text-steel cursor-pointer">
                    Volver
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---- Tarjeta de una RC (Bryan decide; quien envió la sigue) ----------------------

function buyUrl(r: Row): string {
  const params = new URLSearchParams({
    tab: "compras",
    ptab: "solicitar",
    presetCatalogItemId: r.catalogItemId,
    presetSupplierId: r.supplierId,
    presetQuantity: String(r.approvedQuantity ?? r.quantity),
    presetUnitCost: String(r.unitCost),
  });
  return `${window.location.pathname}?${params.toString()}`;
}

function RowCard({ r, data, onChanged }: { r: Row; data: Data; onChanged: () => void }) {
  const [qty, setQty] = useState(String(r.quantity));
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = r.requestedById === data.userId;
  const calc: RepurchaseCalc = {
    bodegaCost: r.unitCost + (r.freightTotal ? r.freightTotal / r.quantity : 0),
    freightPerUnit: r.freightTotal ? r.freightTotal / r.quantity : 0,
    newDropiPrice: r.newDropiPrice,
    marginAtCompetitor: r.marginAtCompetitor,
    maxSupplierCost: r.maxSupplierCost,
    verdict: r.verdict,
  };

  function post(path: string, body?: object) {
    setBusy(true);
    setError(null);
    fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
      .then((res) => res.json().then((j) => ({ ok: res.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) setError(j.error ?? "No se pudo guardar.");
        else onChanged();
      })
      .catch(() => setError("No se pudo guardar."))
      .finally(() => setBusy(false));
  }

  const qtyNum = Number(qty);
  const qtyValid = Number.isInteger(qtyNum) && qtyNum > 0;
  return (
    <div className="bg-surface border border-rule rounded-md p-3">
      <div className="flex items-start gap-3">
        <Thumb src={r.photo} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[12px] font-bold text-steel">{r.code}</span>
            <span className="text-[13.5px] font-bold text-ink">{r.itemName}</span>
            <span className={`text-[12px] font-semibold ${STATE_LABEL[r.state].tone}`}>· {STATE_LABEL[r.state].text}</span>
          </div>
          {r.justCode && (
            <div className="flex items-center gap-1 text-[12px] text-steel">
              ID <CatalogCode code={r.justCode} size="text-[12px]" />
            </div>
          )}
          <div className="text-[12.5px] text-ink mt-0.5">
            {r.audience === "HOT" ? "🔥" : "❄️"} <b>{r.quantity} u.</b>
            {r.approvedQuantity !== null && r.approvedQuantity !== r.quantity ? <> → Bryan aprobó <b>{r.approvedQuantity} u.</b></> : null} a <b>{money(r.unitCost)}</b> con {r.supplierName}
            {r.freightTotal ? ` + ${money(r.freightTotal)} de flete` : ""}
          </div>
          <div className="text-[12px] text-steel">
            Envió {r.requestedByName ?? "—"} el {fmtDateTime(r.requestedAt)} · al enviar quedaban {r.stockAtRequest}, se vendieron {r.soldLast30} en 30 días ({daysLeftText(r.daysLeft)})
          </div>
          {r.stockStillCovered && <div className="text-[12px] text-amber font-semibold mt-0.5">⚠️ Al enviarla todavía había stock suficiente: revisa el motivo en la nota.</div>}
          {r.waitingTooLong && (
            <div className="text-[12px] text-red font-semibold mt-0.5">
              {mine ? "Bryan todavía no responde: habla con él en persona para que la confirme o la rechace." : "Lleva más de 12 horas esperando tu decisión."}
            </div>
          )}
        </div>
      </div>

      <div className="mt-2.5">
        <CompareTable
          lastLabel={r.lastPurchaseAt ? `Última compra (${fmtDate(r.lastPurchaseAt)}${r.lastSupplierName ? `, ${r.lastSupplierName}` : ""})` : "Última compra"}
          lastBodegaCost={r.lastUnitCost}
          todayBodegaCost={calc.bodegaCost}
          todaySupplierCost={r.unitCost}
          todayFreightPerUnit={calc.freightPerUnit}
          publishedDropiPrice={r.publishedDropiPrice}
          newDropiPrice={r.newDropiPrice}
          lastCompetitorPrice={r.lastCompetitorPrice}
          todayCompetitorPrice={r.competitorPrice}
          lastMargin={r.lastMarginAtCompetitor}
          todayMargin={r.marginAtCompetitor}
          marginPercent={r.marginPercent}
        />
        {r.competitorId && <div className="text-[11.5px] text-steel">ID de la competencia: {r.competitorId}</div>}
        {r.noCompetitorNote && <div className="text-[12px] text-steel mt-0.5">Sin competencia: {r.noCompetitorNote}</div>}
        <div className="mt-2">
          <VerdictBox calc={calc} competitorPrice={r.competitorPrice} marginPercent={r.marginPercent} />
        </div>
        {r.note && <div className="text-[12.5px] text-ink mt-2">📝 {r.note}</div>}
      </div>

      {r.state === "REJECTED" && (
        <div className="text-[12.5px] text-red mt-2">
          Rechazada por {r.reviewedByName ?? "Bryan"} el {fmtDate(r.reviewedAt)}: {r.rejectReason}
        </div>
      )}
      {r.state === "APPROVED" && (
        <div className="mt-2.5">
          <div className="text-[12.5px] text-teal">
            Aprobada por {r.reviewedByName ?? "Bryan"} el {fmtDate(r.reviewedAt)} · vale hasta el {fmtDate(r.approvalExpiresAt)}
          </div>
          {mine && (
            <>
              <a href={buyUrl(r)} className="inline-block mt-1.5 rounded bg-teal px-3.5 py-2 text-[12.5px] font-bold text-white">
                Pedir compra →
              </a>
              <div className="text-[11px] text-steel mt-1">
                Se abre Solicitar con el producto, el proveedor, la cantidad y el precio aprobados. Si tenías una solicitud a medias, termínala o descártala primero. No se puede comprar a otro proveedor, a un precio mayor ni más unidades de lo aprobado.
              </div>
            </>
          )}
        </div>
      )}
      {r.state === "EXPIRED" && <div className="text-[12.5px] text-steel mt-2">La aprobación venció el {fmtDate(r.approvalExpiresAt)} sin pedir la compra. Si todavía hace falta, analízala otra vez: los precios cambian.</div>}
      {r.state === "USED" && (
        <div className="text-[12.5px] text-teal mt-2">
          Compra pedida {r.usedPurchaseCode ? `(${r.usedPurchaseCode}) ` : ""}el {fmtDate(r.usedAt)} — sigue en Mis solicitudes.
        </div>
      )}

      {r.state === "PENDING_APPROVAL" && data.canDecide && (
        <div className="mt-3 border-t border-rule pt-2.5">
          {!rejecting ? (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-[11.5px] text-steel">Cantidad a aprobar</label>
                <input type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} className="w-28 rounded border border-rule bg-surface px-2 py-1.5 text-[13px]" />
              </div>
              <button
                type="button"
                disabled={busy || !qtyValid}
                onClick={() => post(`/api/repurchase-reviews/${r.id}/decide`, { decision: "APPROVE", approvedQuantity: qtyNum })}
                className="rounded bg-teal px-3 py-2 text-[12.5px] font-bold text-white cursor-pointer disabled:opacity-50"
              >
                {busy ? "Guardando…" : qtyValid && qtyNum !== r.quantity ? `Aprobar ${qtyNum} u.` : "Aprobar"}
              </button>
              <button type="button" disabled={busy} onClick={() => setRejecting(true)} className="rounded border border-rule px-3 py-2 text-[12.5px] font-semibold text-steel hover:text-red hover:border-red cursor-pointer">
                Rechazar
              </button>
            </div>
          ) : (
            <div>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} placeholder="¿Por qué no se recompra? Quien compra lo ve tal cual (obligatorio)" className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12.5px]" />
              <div className="flex gap-1.5 mt-1.5">
                <button
                  type="button"
                  disabled={busy || reason.trim().length < 5}
                  onClick={() => post(`/api/repurchase-reviews/${r.id}/decide`, { decision: "REJECT", rejectReason: reason.trim() })}
                  className="rounded bg-red px-3 py-1.5 text-[12px] font-bold text-white cursor-pointer disabled:opacity-50"
                >
                  {busy ? "Guardando…" : "Sí, rechazar"}
                </button>
                <button type="button" disabled={busy} onClick={() => setRejecting(false)} className="rounded border border-rule px-3 py-1.5 text-[12px] text-steel cursor-pointer">
                  Volver
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {r.state === "PENDING_APPROVAL" && mine && !data.canDecide && (
        <button
          type="button"
          disabled={busy}
          onClick={() => window.confirm(`¿Retirar la recompra ${r.code}? Bryan ya no la verá.`) && post(`/api/repurchase-reviews/${r.id}/cancel`)}
          className="mt-2 text-[12px] text-steel hover:text-red cursor-pointer"
        >
          Retirar esta recompra
        </button>
      )}
      {error && <div className="text-[12px] text-red mt-1.5">{error}</div>}
    </div>
  );
}

// initialItemId: viene del botón "Analizar recompra" de Qué comprar (cambio
// de pestaña sin recargar la página) o de ?rcItem= en el enlace.
export function RepurchasePanel({ initialItemId = null }: { initialItemId?: string | null }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(() => initialItemId ?? (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rcItem")));
  const [sentCode, setSentCode] = useState<string | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

  function load() {
    fetch("/api/repurchase-reviews")
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) setError(j.error ?? "No se pudo cargar.");
        else setData(j);
      })
      .catch(() => setError("No se pudo cargar."));
  }
  useEffect(load, []);

  if (error) return <div className="text-red text-[13px]">{error}</div>;
  // Con un producto ya elegido, el análisis arranca de una vez, sin esperar
  // a que cargue la lista de recompras de abajo.
  if (!data && !itemId) return <div className="text-steel text-[13px]">Cargando…</div>;

  const ready = data ? data.history.filter((r) => r.state === "APPROVED" && r.requestedById === data.userId) : [];
  const rest = data ? data.history.filter((r) => !(r.state === "APPROVED" && r.requestedById === data.userId)) : [];
  const shownRest = showAllHistory ? rest : rest.slice(0, 8);

  return (
    <div>
      {(data ? data.canRequest : !!itemId) && (
        <div className="bg-surface2 border border-rule rounded-md p-3.5 mb-5">
          <div className="text-[14px] font-bold text-ink mb-0.5">🔁 Analizar una recompra</div>
          <div className="text-[12px] text-steel mb-3">
            Toda recompra necesita la aprobación de Bryan antes de pedir la compra. Así no compramos algo que la competencia vende más barato.
          </div>
          {sentCode ? (
            <div className="bg-teal/10 border border-teal/40 rounded-md px-3 py-2.5 text-[12.5px] text-ink">
              Listo: <b>{sentCode}</b> se envió a Bryan. Te avisamos cuando decida. Si no responde, te va a salir en Inicio para que hables con él en persona.
              <button
                type="button"
                className="block mt-1.5 text-teal font-semibold cursor-pointer"
                onClick={() => {
                  setSentCode(null);
                  setItemId(null);
                }}
              >
                Analizar otro producto
              </button>
            </div>
          ) : itemId ? (
            <Analyzer
              key={itemId}
              itemId={itemId}
              onBack={() => setItemId(null)}
              onSent={(code) => {
                setSentCode(code);
                load();
              }}
            />
          ) : (
            <>
              <div className="text-[13px] font-bold text-ink mb-1.5">Paso 1 · ¿Qué producto vas a recomprar?</div>
              <ItemSearch onPick={(i) => setItemId(i.id)} />
            </>
          )}
        </div>
      )}

      {!data ? (
        <div className="text-steel text-[13px]">Cargando recompras…</div>
      ) : (
        <>
      {ready.length > 0 && (
        <div className="mb-5">
          <div className="text-[14px] font-bold text-teal mb-2">🛒 Aprobadas — pide la compra ({ready.length})</div>
          <div className="flex flex-col gap-2.5">
            {ready.map((r) => (
              <RowCard key={r.id} r={r} data={data} onChanged={load} />
            ))}
          </div>
        </div>
      )}

      <div className="mb-5">
        <div className="text-[14px] font-bold text-amber mb-0.5">⏳ Esperando a Bryan ({data.pending.length})</div>
        <div className="text-[12px] text-steel mb-2">
          {data.canDecide
            ? "Revisa la cuenta y decide. Puedes cambiar la cantidad; el proveedor no. Sin tu aprobación no se puede pedir la compra."
            : "Si Bryan no responde en 12 horas, te sale en Inicio para que hables con él en persona."}
        </div>
        {data.pending.length === 0 ? (
          <div className="text-[13px] text-steel">Nada esperando.</div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {data.pending.map((r) => (
              <RowCard key={r.id} r={r} data={data} onChanged={load} />
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-[14px] font-bold text-ink mb-2">Historial{data.canViewAll ? "" : " (tus recompras)"}</div>
        {rest.length === 0 ? (
          <div className="text-[13px] text-steel">Todavía no hay recompras resueltas.</div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {shownRest.map((r) => (
              <RowCard key={r.id} r={r} data={data} onChanged={load} />
            ))}
            {rest.length > shownRest.length && (
              <button type="button" onClick={() => setShowAllHistory(true)} className="text-[12.5px] text-teal font-semibold cursor-pointer self-start">
                Ver {rest.length - shownRest.length} más
              </button>
            )}
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
