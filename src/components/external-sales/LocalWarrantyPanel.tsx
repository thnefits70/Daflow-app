"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Paperclip, Plus, Search, ShieldCheck, Trash2, X } from "lucide-react";
import type { WarrantySource } from "@/lib/localWarranty";
import {
  EXTRA_REASONS,
  WARRANTY_MAX_DAYS,
  WARRANTY_NORMAL_DAYS,
  WARRANTY_PICKUP_FREIGHT_AVG,
  WARRANTY_REASONS,
  anyReasonLabel,
  reasonDiscountsStock,
  type ExtraReasonCode,
  type WarrantyReasonCode,
} from "@/lib/localWarrantyConstants";
import { uploadFile } from "@/lib/uploadFile";
import { LogisticsProviderPicker } from "./LogisticsProviderPicker";
import { formatDateTime } from "@/lib/formatDateTime";

// Garantías locales (Guayaquil, motorizado propio) — pedido del usuario
// 2026-10-02. El asesor escribe la guía original (o la venta VE-000X) y
// DAFLOW trae solo el cliente, la dirección y los productos: él solo elige
// qué falta entregar, el motivo de cada producto, el cobro y el motorizado.

type LineState = { on: boolean; qty: string; reason: WarrantyReasonCode | ""; pickupDefective: boolean };
type Extra = { catalogItemId: string; name: string; qty: string; reason: ExtraReasonCode; pickup: boolean };
type CatalogItem = { id: string; name: string; justCode: string | null };

const money = (n: number) => `$${n.toFixed(2)}`;

export function LocalWarrantyPanel() {
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div className="flex flex-col gap-8">
      <WarrantyForm onCreated={() => setReloadKey((k) => k + 1)} />
      <MyWarranties key={reloadKey} />
    </div>
  );
}

function WarrantyForm({ onCreated }: { onCreated: () => void }) {
  const [ref, setRef] = useState("");
  const [looking, setLooking] = useState(false);
  const [lookupErr, setLookupErr] = useState("");
  const [src, setSrc] = useState<WarrantySource | null>(null);
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [extras, setExtras] = useState<Extra[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [extraQuery, setExtraQuery] = useState("");
  const [showExtras, setShowExtras] = useState(false);
  const [phone, setPhone] = useState("");
  const [nameIn, setNameIn] = useState("");
  const [addressIn, setAddressIn] = useState("");
  const [evidence, setEvidence] = useState<{ url: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [chargeMode, setChargeMode] = useState<"NONE" | "ORIGINAL" | "CUSTOM">("NONE");
  const [chargeAmount, setChargeAmount] = useState("");
  const [pickupPersonName, setPickupPersonName] = useState("");
  const [freightCost, setFreightCost] = useState("");
  const [showLabel, setShowLabel] = useState(false);
  const [step, setStep] = useState<"edit" | "confirm1" | "confirm2">("edit");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  function reset() {
    setSrc(null);
    setLines({});
    setExtras([]);
    setShowExtras(false);
    setPhone("");
    setNameIn("");
    setAddressIn("");
    setEvidence([]);
    setChargeMode("NONE");
    setChargeAmount("");
    setPickupPersonName("");
    setFreightCost("");
    setStep("edit");
    setErr("");
  }

  async function lookup() {
    if (!ref.trim()) return;
    reset();
    setDone("");
    setLooking(true);
    setLookupErr("");
    const res = await fetch(`/api/external-sales/warranty/lookup?ref=${encodeURIComponent(ref.trim())}`);
    const json = await res.json().catch(() => null);
    setLooking(false);
    if (!res.ok) {
      setLookupErr(json?.error ?? "No se pudo buscar.");
      return;
    }
    const s = json as WarrantySource;
    setSrc(s);
    setPhone(s.clientPhone ?? "");
    setLines(Object.fromEntries(s.lines.map((l) => [l.catalogItemId, { on: false, qty: "1", reason: "", pickupDefective: false }])));
  }

  function setLine(id: string, patch: Partial<LineState>) {
    setLines((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function ensureCatalog() {
    if (catalog) return;
    const res = await fetch("/api/external-sales/catalog-search");
    setCatalog(res.ok ? await res.json() : []);
  }

  async function addEvidence(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setErr("");
    for (const f of Array.from(files)) {
      const r = await uploadFile(f, "external-sale-warranty-evidence");
      if (r.ok) setEvidence((prev) => [...prev, { url: r.url, name: r.name }]);
      else setErr(r.error);
    }
    setUploading(false);
  }

  if (!src) {
    return (
      <section>
        <h2 className="font-display text-[16px] font-bold mb-1 flex items-center gap-2">
          <ShieldCheck size={16} /> Nueva garantía en Guayaquil
        </h2>
        <p className="text-[12.5px] text-steel mb-3">Escribe la guía que salió (Dropi/Rocket) o el código de la venta externa (VE-0000). DAFLOW trae solo el cliente, la dirección y los productos.</p>
        {done && <div className="text-[12.5px] text-teal mb-2 flex items-center gap-1.5"><CheckCircle2 size={14} /> {done}</div>}
        <div className="flex gap-2 max-w-md">
          <input
            className="flex-1 rounded border border-rule bg-surface px-3 py-2 text-[13px] font-mono uppercase"
            placeholder="Ej. D002055162 o VE-0021"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && lookup()}
            disabled={looking}
          />
          <button type="button" className="flex items-center gap-1.5 rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={lookup} disabled={looking || !ref.trim()}>
            {looking ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Buscar
          </button>
        </div>
        {looking && <div className="text-[12px] text-steel mt-2">Buscando la guía en los PDF del corte… puede tardar unos segundos.</div>}
        {lookupErr && <div className="text-[12.5px] text-red mt-2">{lookupErr}</div>}
      </section>
    );
  }

  const late = src.daysSince > WARRANTY_NORMAL_DAYS;
  const tooLate = src.daysSince > WARRANTY_MAX_DAYS;
  const blocked = !src.isGuayaquil || tooLate;
  const chosen = src.lines.filter((l) => lines[l.catalogItemId]?.on);
  const deliver = chosen.map((l) => ({ line: l, st: lines[l.catalogItemId] }));
  const qtyOk = deliver.every(({ line, st }) => {
    const q = Number(st.qty);
    return Number.isInteger(q) && q >= 1 && q <= line.quantity - line.alreadyUsed;
  });
  const reasonsOk = deliver.every(({ st }) => !!st.reason);
  const hasDifferent = deliver.some(({ st }) => st.reason === "ORDEN_DIFERENTE");
  const extrasOk = extras.every((e) => Number.isInteger(Number(e.qty)) && Number(e.qty) >= 1);
  const needsEvidence = deliver.some(({ st }) => st.reason && st.reason !== "ORDEN_INCOMPLETA") || extras.length > 0;
  const phoneDigits = phone.replace(/\D/g, "");
  const finalName = src.clientName ?? nameIn.trim();
  const finalAddress = src.clientAddress ?? addressIn.trim();
  const charge = chargeMode === "NONE" ? 0 : chargeMode === "ORIGINAL" ? (src.originalCharge ?? 0) : Number(chargeAmount);
  const chargeOk = chargeMode !== "CUSTOM" || (Number.isFinite(charge) && charge > 0);
  const freightOk = Number(freightCost) > 0;
  const canReview =
    !blocked && deliver.length > 0 && qtyOk && reasonsOk && extrasOk && (!needsEvidence || evidence.length > 0) && phoneDigits.length >= 7 && !!finalName && !!finalAddress && chargeOk && freightOk && !!pickupPersonName.trim() && !uploading;

  const discounted = deliver.filter(({ st }) => st.reason && reasonDiscountsStock(st.reason)).reduce((s, { st }) => s + Number(st.qty), 0) + extras.filter((e) => !e.pickup).reduce((s, e) => s + Number(e.qty), 0);
  const notDiscounted = deliver.filter(({ st }) => st.reason && !reasonDiscountsStock(st.reason)).reduce((s, { st }) => s + Number(st.qty), 0);
  const pickups = [
    ...deliver.filter(({ st }) => st.pickupDefective && (st.reason === "MAL_FUNCIONAMIENTO" || st.reason === "PRODUCTO_ROTO")).map(({ line, st }) => `${line.name} ×${st.qty} (dañado)`),
    ...extras.filter((e) => e.pickup).map((e) => `${e.name} ×${e.qty}`),
  ];

  async function save() {
    if (!src) return;
    setSaving(true);
    setErr("");
    const res = await fetch("/api/external-sales/warranty", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: src.ref,
        deliver: deliver.map(({ line, st }) => ({ catalogItemId: line.catalogItemId, quantity: Number(st.qty), reason: st.reason, pickupDefective: st.pickupDefective })),
        extras: extras.map((e) => ({ catalogItemId: e.catalogItemId, quantity: Number(e.qty), reason: e.reason, pickup: e.pickup })),
        clientPhone: phone,
        clientName: src.clientName ? null : nameIn.trim(),
        clientAddress: src.clientAddress ? null : addressIn.trim(),
        chargeMode,
        chargeAmount: chargeMode === "CUSTOM" ? Number(chargeAmount) : null,
        freightCost: Number(freightCost),
        pickupPersonName: pickupPersonName.trim(),
        evidenceUrls: evidence.map((e) => e.url),
        acceptLate: late,
      }),
    });
    const json = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo guardar.");
      setStep("edit");
      return;
    }
    setDone(`Garantía ${json.code} enviada a Bryan para aprobar. Cuando la apruebe pasa a INVESTOCK.`);
    setRef("");
    reset();
    onCreated();
  }

  const filteredCatalog = (catalog ?? []).filter((c) => {
    const q = extraQuery.trim().toLowerCase();
    return q.length >= 2 && (c.name.toLowerCase().includes(q) || (c.justCode ?? "").includes(q));
  });

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="font-display text-[16px] font-bold flex items-center gap-2">
          <ShieldCheck size={16} /> Garantía de {src.kind === "GUIDE" ? `la guía ${src.ref}` : `la venta ${src.ref}`}
        </h2>
        <button type="button" className="text-steel text-[12.5px] cursor-pointer flex items-center gap-1" onClick={() => { reset(); setLookupErr(""); }}>
          <X size={13} /> Cambiar guía
        </button>
      </div>

      {/* Datos de la guía original */}
      <div className="border border-rule rounded-md p-3 mb-4 text-[12.5px] grid gap-1">
        <div>
          <span className="text-steel">Salió el </span>
          <b>{new Date(src.shippedAt).toLocaleDateString("es-EC", { day: "2-digit", month: "2-digit", year: "numeric" })}</b>
          <span className="text-steel"> · hace </span>
          <b className={late ? "text-red" : ""}>{src.daysSince} días</b>
          {src.carrier && <span className="text-steel"> · {src.carrier}</span>}
          <span className="text-steel"> · ciudad </span>
          <b className={src.isGuayaquil ? "" : "text-red"}>{src.city ?? "—"}</b>
          {src.originalCharge != null && <span className="text-steel"> · valor de la guía {money(src.originalCharge)}</span>}
        </div>
        {!src.isGuayaquil && <div className="text-red font-semibold">Esta guía no es de Guayaquil: la garantía con motorizado propio es solo para Guayaquil.</div>}
        {tooLate && <div className="text-red font-semibold">Ya pasaron más de {WARRANTY_MAX_DAYS} días: no se puede hacer la garantía.</div>}
        {late && !tooLate && <div className="text-gold font-semibold flex items-center gap-1"><AlertTriangle size={13} /> Pasaron más de {WARRANTY_NORMAL_DAYS} días: se pedirá confirmar que igual se acepta.</div>}
        {src.warnings.map((w, i) => (
          <div key={i} className="text-gold">{w}</div>
        ))}
      </div>

      {!blocked && (
        <>
          {/* Cliente */}
          <div className="mb-4">
            <div className="text-[12px] font-bold uppercase tracking-wide text-steel mb-1.5">Cliente (de la guía original)</div>
            <div className="grid gap-2 text-[13px] max-w-xl">
              <div>
                <span className="text-steel">Nombre: </span>
                {src.clientName ? <b>{src.clientName}</b> : <input className="rounded border border-rule bg-surface px-2 py-1 text-[13px] w-72" placeholder="No se pudo leer: escribe el nombre" value={nameIn} onChange={(e) => setNameIn(e.target.value)} />}
              </div>
              <div>
                <span className="text-steel">Dirección: </span>
                {src.clientAddress ? <b>{src.clientAddress}</b> : <input className="rounded border border-rule bg-surface px-2 py-1 text-[13px] w-full" placeholder="No se pudo leer: escribe la dirección" value={addressIn} onChange={(e) => setAddressIn(e.target.value)} />}
              </div>
              {src.notes && <div><span className="text-steel">Referencia: </span>{src.notes}</div>}
              <div>
                <span className="text-steel">Celular: </span>
                <input className="rounded border border-rule bg-surface px-2 py-1 text-[13px] font-mono w-40" placeholder="09…" value={phone} onChange={(e) => setPhone(e.target.value)} />
                {!src.clientPhone && <span className="text-[11.5px] text-gold ml-2">La etiqueta no trae el celular del cliente: escríbelo, el motorizado lo necesita para coordinar y pedirle la ubicación.</span>}
              </div>
            </div>
            {src.labelText.length > 0 && (
              <button type="button" className="text-[11.5px] text-teal mt-1.5 cursor-pointer" onClick={() => setShowLabel((v) => !v)}>
                {showLabel ? "Ocultar" : "Ver"} el texto de la etiqueta original
              </button>
            )}
            {showLabel && <pre className="mt-1 text-[11px] bg-cloud border border-rule rounded p-2 whitespace-pre-wrap max-w-xl">{src.labelText.join("\n")}</pre>}
          </div>

          {/* Productos de la guía */}
          <div className="mb-4">
            <div className="text-[12px] font-bold uppercase tracking-wide text-steel mb-1.5">¿Qué se le entrega? (solo lo que llevaba la guía)</div>
            <div className="flex flex-col gap-2">
              {src.lines.map((l) => {
                const st = lines[l.catalogItemId];
                const left = l.quantity - l.alreadyUsed;
                const r = WARRANTY_REASONS.find((x) => x.code === st?.reason);
                return (
                  <div key={l.catalogItemId} className={`border rounded-md p-2.5 ${st?.on ? "border-teal" : "border-rule"}`}>
                    <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                      <input type="checkbox" checked={!!st?.on} disabled={left <= 0} onChange={(e) => setLine(l.catalogItemId, { on: e.target.checked })} />
                      {l.photo && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img loading="lazy" decoding="async" src={l.photo} alt="" className="w-8 h-8 rounded object-cover" />
                      )}
                      <span className="flex-1">
                        <b>{l.name}</b> <span className="text-steel font-mono text-[11px]">{l.code ?? ""}</span>
                        <span className="text-steel"> · la guía llevaba {l.quantity}{l.alreadyUsed ? ` · ya se usaron ${l.alreadyUsed} en otra garantía` : ""}</span>
                      </span>
                    </label>
                    {left <= 0 && <div className="text-[11.5px] text-steel pl-6">Ya no queda nada de este producto por cubrir con garantía.</div>}
                    {st?.on && (
                      <div className="pl-6 mt-2 grid gap-2">
                        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                          <span>Cantidad</span>
                          <input type="number" min={1} max={left} className="w-16 rounded border border-rule bg-surface px-2 py-1" value={st.qty} onChange={(e) => setLine(l.catalogItemId, { qty: e.target.value })} />
                          <span className="text-steel">máx. {left}</span>
                          <select className="rounded border border-rule bg-surface px-2 py-1" value={st.reason} onChange={(e) => setLine(l.catalogItemId, { reason: e.target.value as WarrantyReasonCode, pickupDefective: false })}>
                            <option value="">Motivo…</option>
                            {WARRANTY_REASONS.map((x) => (
                              <option key={x.code} value={x.code}>{x.label}</option>
                            ))}
                          </select>
                        </div>
                        {Number(st.qty) > left && <div className="text-[11.5px] text-red">No puedes entregar más de {left}.</div>}
                        {r && (
                          <div className="text-[12px] bg-cloud border border-rule rounded p-2">
                            <div>{r.explain}</div>
                            <div className="font-semibold mt-0.5">{r.stock}</div>
                            {r.evidence && <div className="text-steel mt-0.5">📷 {r.evidence}</div>}
                            {r.warning && <div className="text-gold mt-0.5 flex gap-1"><AlertTriangle size={13} className="shrink-0 mt-0.5" /> {r.warning}</div>}
                          </div>
                        )}
                        {(st.reason === "MAL_FUNCIONAMIENTO" || st.reason === "PRODUCTO_ROTO") && (
                          <label className="flex items-center gap-2 text-[12.5px] cursor-pointer">
                            <input type="checkbox" checked={st.pickupDefective} onChange={(e) => setLine(l.catalogItemId, { pickupDefective: e.target.checked })} />
                            El motorizado recoge el producto dañado y lo trae a bodega
                          </label>
                        )}
                        {/* Pedido del usuario 2026-10-02: recoger cuesta un flete aparte —
                            DAFLOW recomienda según el costo real del producto. */}
                        {(st.reason === "MAL_FUNCIONAMIENTO" || st.reason === "PRODUCTO_ROTO") && l.pickupMinQty != null && (
                          <PickupAdvice worth={Number(st.qty) >= l.pickupMinQty} minQty={l.pickupMinQty} />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Lo que el cliente recibió por error */}
          {(hasDifferent || extras.length > 0 || showExtras) && (
            <div className="mb-4">
              <div className="text-[12px] font-bold uppercase tracking-wide text-steel mb-1">¿Qué recibió el cliente que no debía?</div>
              <div className="text-[12px] text-steel mb-2">Ese producto salió de bodega sin estar en la guía. Si el motorizado lo recoge, vuelve a bodega y el stock no cambia; si el cliente se lo queda, se descuenta del stock.</div>
              {extras.map((e, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-[12.5px] mb-1.5">
                  <b className="min-w-0">{e.name}</b>
                  <input type="number" min={1} className="w-16 rounded border border-rule bg-surface px-2 py-1" value={e.qty} onChange={(ev) => setExtras((p) => p.map((x, j) => (j === i ? { ...x, qty: ev.target.value } : x)))} />
                  <select className="rounded border border-rule bg-surface px-2 py-1" value={e.reason} onChange={(ev) => setExtras((p) => p.map((x, j) => (j === i ? { ...x, reason: ev.target.value as ExtraReasonCode } : x)))}>
                    {EXTRA_REASONS.map((x) => (
                      <option key={x.code} value={x.code}>{x.label}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={e.pickup} onChange={(ev) => setExtras((p) => p.map((x, j) => (j === i ? { ...x, pickup: ev.target.checked } : x)))} />
                    El motorizado lo recoge
                  </label>
                  {!e.pickup && <span className="text-[11.5px] text-gold">El cliente se lo queda: se descuenta del stock</span>}
                  <button type="button" className="text-steel cursor-pointer" onClick={() => setExtras((p) => p.filter((_, j) => j !== i))}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <div className="relative max-w-md">
                <input
                  className="w-full rounded border border-rule bg-surface px-2 py-1.5 text-[12.5px]"
                  placeholder="Busca el producto que recibió (nombre o ID)…"
                  value={extraQuery}
                  onFocus={ensureCatalog}
                  onChange={(e) => setExtraQuery(e.target.value)}
                />
                {filteredCatalog.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 mt-1 max-h-56 overflow-auto bg-surface border border-rule rounded shadow">
                    {filteredCatalog.slice(0, 20).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full text-left px-2 py-1.5 text-[12.5px] hover:bg-cloud cursor-pointer flex items-center gap-1.5"
                        onClick={() => {
                          setExtras((p) => [...p, { catalogItemId: c.id, name: c.name, qty: "1", reason: "ORDEN_DIFERENTE", pickup: true }]);
                          setExtraQuery("");
                        }}
                      >
                        <Plus size={12} /> {c.name} <span className="text-steel font-mono text-[11px]">{c.justCode ?? ""}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {!hasDifferent && extras.length === 0 && !showExtras && (
            <button
              type="button"
              className="text-[12px] text-teal mb-4 cursor-pointer"
              onClick={() => {
                ensureCatalog();
                setShowExtras(true);
              }}
            >
              + El cliente recibió algo de más o que no era
            </button>
          )}

          {/* Evidencia */}
          <div className="mb-4">
            <div className="text-[12px] font-bold uppercase tracking-wide text-steel mb-1.5">Fotos o videos que revisaste {needsEvidence ? "(obligatorio)" : "(opcional)"}</div>
            <label className="inline-flex items-center gap-1.5 rounded border border-rule px-3 py-1.5 text-[12.5px] cursor-pointer">
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />} Adjuntar
              <input type="file" accept="image/*,video/*" multiple className="hidden" disabled={uploading} onChange={(e) => addEvidence(e.target.files)} />
            </label>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {evidence.map((e, i) => (
                <span key={i} className="text-[11.5px] border border-rule rounded px-2 py-0.5 flex items-center gap-1">
                  {e.name}
                  <button type="button" className="cursor-pointer" onClick={() => setEvidence((p) => p.filter((_, j) => j !== i))}>
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Cobro */}
          <div className="mb-4">
            <div className="text-[12px] font-bold uppercase tracking-wide text-steel mb-1.5">Cobro al cliente</div>
            <div className="flex flex-col gap-1 text-[13px]">
              <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={chargeMode === "NONE"} onChange={() => setChargeMode("NONE")} /> Sin cobro</label>
              {src.originalCharge != null && src.originalCharge > 0 && (
                <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={chargeMode === "ORIGINAL"} onChange={() => setChargeMode("ORIGINAL")} /> El mismo valor de la guía original ({money(src.originalCharge)})</label>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={chargeMode === "CUSTOM"} onChange={() => setChargeMode("CUSTOM")} /> Valor acordado con el dropshipper
                {chargeMode === "CUSTOM" && <input type="number" min={0} step="0.01" className="w-24 rounded border border-rule bg-surface px-2 py-1" placeholder="$" value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value)} />}
              </label>
            </div>
          </div>

          {/* Motorizado */}
          <div className="mb-4 max-w-md">
            <div className="text-[12px] font-bold uppercase tracking-wide text-steel mb-1.5">Motorizado</div>
            <LogisticsProviderPicker value={pickupPersonName} onChange={setPickupPersonName} />
            <div className="flex items-center gap-2 mt-2 text-[13px]">
              <span>Flete que cobra por esta garantía</span>
              <input type="number" min={0} step="0.01" className="w-24 rounded border border-rule bg-surface px-2 py-1" placeholder="$" value={freightCost} onChange={(e) => setFreightCost(e.target.value)} />
            </div>
            {pickups.length > 0 && <div className="text-[11.5px] text-steel mt-1">Como tiene que recoger y traer de vuelta, el flete suele ser un poco más alto.</div>}
            <div className="text-[11.5px] text-steel mt-1">El flete se paga desde Caja Chica entregue o no la garantía.</div>
          </div>

          {err && <div className="text-red text-[12.5px] mb-2">{err}</div>}

          {step === "edit" && (
            <button type="button" disabled={!canReview} className="rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-50" onClick={() => setStep("confirm1")}>
              Revisar antes de enviar
            </button>
          )}

          {step === "confirm1" && (
            <div className="border border-teal rounded-md p-3 bg-cloud text-[12.5px] max-w-xl">
              <div className="font-bold text-[13.5px] mb-1.5">Revisa antes de enviar</div>
              <div>{src.kind === "GUIDE" ? "Guía" : "Venta"} <b>{src.ref}</b> · <b>{finalName}</b> · {finalAddress} · <b>{phone}</b></div>
              <div className="mt-1.5 font-semibold">Se entrega:</div>
              <ul className="list-disc pl-5">
                {deliver.map(({ line, st }) => (
                  <li key={line.catalogItemId}>{line.name} ×{st.qty} — {anyReasonLabel(st.reason)} — {st.reason && reasonDiscountsStock(st.reason) ? "se descuenta del stock" : "no se descuenta (nunca salió)"}</li>
                ))}
              </ul>
              {pickups.length > 0 && (
                <>
                  <div className="mt-1 font-semibold">El motorizado recoge y trae a bodega:</div>
                  <ul className="list-disc pl-5">{pickups.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </>
              )}
              {extras.some((e) => !e.pickup) && (
                <div className="mt-1">El cliente se queda: {extras.filter((e) => !e.pickup).map((e) => `${e.name} ×${e.qty}`).join(", ")} — se descuenta del stock.</div>
              )}
              <div className="mt-1.5">Stock: se descuentan <b>{discounted}</b> unidades{notDiscounted > 0 ? `; ${notDiscounted} no se descuentan porque nunca salieron` : ""}.</div>
              <div>Cobro al cliente: <b>{money(charge)}</b> · Flete al motorizado ({pickupPersonName}): <b>{money(Number(freightCost))}</b></div>
              {late && <div className="text-gold font-semibold mt-1">Pasaron {src.daysSince} días desde que salió (más de {WARRANTY_NORMAL_DAYS}): al continuar confirmas que igual se acepta.</div>}
              <div className="flex gap-2 mt-2.5">
                <button type="button" className="rounded border border-rule px-3 py-1.5 font-semibold cursor-pointer" onClick={() => setStep("edit")}>Corregir</button>
                <button type="button" className="rounded border border-teal bg-teal px-3 py-1.5 font-bold text-navy cursor-pointer" onClick={() => setStep("confirm2")}>Continuar</button>
              </div>
            </div>
          )}

          {step === "confirm2" && (
            <div className="border border-gold rounded-md p-3 bg-cloud text-[12.5px] max-w-xl">
              <div className="font-bold text-[13.5px] mb-1">¿Seguro?</div>
              <div>Al confirmar se crea la garantía y le llega a Bryan para aprobarla; cuando la apruebe pasa a INVESTOCK. <b>Ya no se puede cambiar el motivo ni los productos</b> (mientras espera a Bryan sí puedes cancelarla).</div>
              <div className="flex gap-2 mt-2.5">
                <button type="button" className="rounded border border-rule px-3 py-1.5 font-semibold cursor-pointer" onClick={() => setStep("edit")} disabled={saving}>Cancelar</button>
                <button type="button" className="rounded border border-gold bg-gold px-3 py-1.5 font-bold text-navy cursor-pointer disabled:opacity-60" onClick={save} disabled={saving}>
                  {saving ? "Enviando…" : "Sí, enviar garantía"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

type WarrantyRow = {
  id: string;
  code: string;
  createdAt: string;
  clientName: string | null;
  totalAmount: number;
  freightCost: number | null;
  pickupPersonName: string;
  warrantySourceGuide: string | null;
  warrantySourceSale: { code: string } | null;
  paymentProofUrl: string | null;
  paymentConfirmedAt: string | null;
  dispatchAssignedTo: { name: string } | null;
  prepReadyAt: string | null;
  packAssignedTo: { name: string } | null;
  deliveredAt: string | null;
  clientReceivedAt: string | null;
  returnedAt: string | null;
  returnConfirmedAt: string | null;
  freightPaidAt: string | null;
  freightPaidBy: { name: string } | null;
  deletedAt: string | null;
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  items: { id: string; quantity: number; warrantyRole: string | null; warrantyReason: string | null; discountsStock: boolean; declaredProductName: string; pickupReceivedAt: string | null; pickupReceivedBy: { name: string } | null; catalogItem: { name: string } | null }[];
};

// Pedido del usuario 2026-10-02: recomendación de recoger o no el producto
// dañado, con un "¿Por qué?" que se abre al tocarlo. Sin el costo del
// producto — solo el flete promedio, que es público para el asesor.
function PickupAdvice({ worth, minQty }: { worth: boolean; minQty: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`text-[12px] ${worth ? "text-teal" : "text-gold"}`}>
      <div className="flex gap-1">
        {worth ? <CheckCircle2 size={13} className="shrink-0 mt-0.5" /> : <AlertTriangle size={13} className="shrink-0 mt-0.5" />}
        <span>
          {worth ? "Conviene recogerlo." : "No conviene recogerlo."}{" "}
          <button type="button" className="underline font-semibold cursor-pointer" onClick={() => setOpen((o) => !o)}>
            {open ? "Ocultar" : "¿Por qué?"}
          </button>
        </span>
      </div>
      {open && (
        <div className="mt-1 ml-4.5 rounded border border-rule bg-cloud p-2 text-ink">
          <div>Recoger el producto cuesta un flete de unos ${WARRANTY_PICKUP_FREIGHT_AVG} (es un promedio: cambia según la distancia y el sector).</div>
          {worth ? (
            <div className="mt-1">Lo que se recoge vale más que ese flete. Si lo traemos, perdemos solo el flete y recuperamos el producto para repararlo, cambiarlo con el proveedor o volver a venderlo si está bien.</div>
          ) : (
            <div className="mt-1">
              Lo que se recoge vale menos que ese flete: pagaríamos más por traerlo que lo que vale. Es mejor que el cliente se quede con el dañado.
              <div className="mt-1">Recógelo igual solo si crees que el producto puede estar bien (por ejemplo, el cliente quiere quedarse con dos) o si se puede cambiar con el proveedor.</div>
            </div>
          )}
          {minQty > 1 && <div className="mt-1 text-steel">Se cuenta la cantidad: desde {minQty} unidades juntas ya vale más que el flete.</div>}
        </div>
      )}
    </div>
  );
}

function statusOf(w: WarrantyRow): string {
  if (w.deletedAt) return "Cancelada";
  if (w.reviewStatus === "PENDING") return "Esperando aprobación de Bryan";
  if (w.reviewStatus === "REJECTED") return "Rechazada por Bryan";
  if (w.freightPaidAt) return `Cerrada · flete pagado${w.freightPaidBy ? ` por ${w.freightPaidBy.name}` : ""}`;
  if (w.clientReceivedAt) return "Entregada al cliente · flete por pagar";
  if (w.returnedAt) return w.returnConfirmedAt ? "No se entregó · volvió a bodega" : "No se entregó · esperando que vuelva a bodega";
  if (w.deliveredAt) return "Salió con el motorizado";
  if (w.packAssignedTo) return `Embalando: ${w.packAssignedTo.name}`;
  if (w.prepReadyAt) return "Agrupada · falta asignar quién embala";
  if (w.dispatchAssignedTo) return `Agrupando: ${w.dispatchAssignedTo.name}`;
  return "En INVESTOCK · falta asignar quién agrupa";
}

function MyWarranties() {
  const [rows, setRows] = useState<WarrantyRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: "received" | "notDelivered" | "cancel" } | null>(null);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/external-sales/warranty")
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows)
      .catch(() => setRows([]));
  }
  useEffect(load, []);

  async function act(id: string, action: "received" | "notDelivered" | "cancel") {
    setBusy(id);
    setErr("");
    const res =
      action === "cancel"
        ? await fetch(`/api/external-sales/${id}`, { method: "DELETE" })
        : action === "received"
        ? await fetch(`/api/external-sales/${id}/client-received`, { method: "POST" })
        : await fetch(`/api/external-sales/${id}/report-return`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Garantía no entregada al cliente" }) });
    const json = await res.json().catch(() => null);
    setBusy(null);
    setConfirm(null);
    if (!res.ok) setErr(json?.error ?? "No se pudo guardar.");
    load();
  }

  async function uploadProof(id: string, file: File) {
    setBusy(id);
    setErr("");
    const up = await uploadFile(file, "external-sale-payment-proofs");
    if (!up.ok) {
      setBusy(null);
      setErr(up.error);
      return;
    }
    const res = await fetch(`/api/external-sales/${id}/payment-proof`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proofUrl: up.url, proofName: up.name }) });
    const json = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok) setErr(json?.error ?? "No se pudo subir el comprobante.");
    load();
  }

  if (rows === null) return <div className="text-steel text-[13px]">Cargando tus garantías…</div>;
  return (
    <section>
      <h2 className="font-display text-[16px] font-bold mb-2">Mis garantías</h2>
      {err && <div className="text-red text-[12.5px] mb-2">{err}</div>}
      {rows.length === 0 && <div className="text-steel text-[13px]">Todavía no registraste garantías.</div>}
      <div className="flex flex-col gap-2">
        {rows.map((w) => {
          const deliver = w.items.filter((i) => i.warrantyRole === "DELIVER");
          const pickup = w.items.filter((i) => i.warrantyRole === "PICKUP");
          const waitingPickup = pickup.some((i) => !i.pickupReceivedAt);
          const canClose = !!w.deliveredAt && !w.clientReceivedAt && !w.returnedAt && !w.deletedAt;
          const name = (i: WarrantyRow["items"][number]) => i.catalogItem?.name ?? i.declaredProductName;
          return (
            <div key={w.id} className="border border-rule rounded-md p-3 text-[12.5px]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <b className="font-mono text-[13px]">{w.code}</b>
                <span className="text-steel">de {w.warrantySourceGuide ?? w.warrantySourceSale?.code}</span>
                <span>{w.clientName}</span>
                <span className="text-steel">{formatDateTime(w.createdAt)}</span>
                <span className="ml-auto font-semibold">{statusOf(w)}</span>
              </div>
              <div className="mt-1">
                Entregar: {deliver.map((i) => `${name(i)} ×${i.quantity} (${anyReasonLabel(i.warrantyReason)})`).join(" · ")}
              </div>
              {pickup.length > 0 && (
                <div className="mt-0.5">
                  Recoger: {pickup.map((i) => `${name(i)} ×${i.quantity}${i.pickupReceivedAt ? ` ✓ recibido${i.pickupReceivedBy ? ` por ${i.pickupReceivedBy.name}` : ""}` : " · bodega aún no lo recibe"}`).join(" · ")}
                </div>
              )}
              <div className="mt-0.5 text-steel">
                Cobro {money(w.totalAmount)} · Flete {money(w.freightCost ?? 0)} ({w.pickupPersonName})
              </div>
              {w.reviewStatus === "REJECTED" && !w.deletedAt && (
                <div className="mt-1 text-red">Motivo de Bryan: {w.rejectionReason ?? "—"}. No sale nada de bodega; si hace falta, crea otra garantía corregida.</div>
              )}
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {w.reviewStatus === "APPROVED" && <a href={`/ventas-externas/${w.id}/guia`} target="_blank" rel="noreferrer" className="rounded border border-rule px-2.5 py-1 font-semibold">Ver guía {w.code}</a>}
                {w.reviewStatus === "PENDING" && !w.deletedAt && confirm?.id !== w.id && (
                  <button type="button" className="rounded border border-rule px-2.5 py-1 font-semibold cursor-pointer" onClick={() => setConfirm({ id: w.id, action: "cancel" })}>
                    Cancelar garantía
                  </button>
                )}
                {w.reviewStatus === "APPROVED" && w.totalAmount > 0 && !w.paymentConfirmedAt && !w.deletedAt && (
                  <label className="rounded border border-rule px-2.5 py-1 font-semibold cursor-pointer">
                    {w.paymentProofUrl ? "Cambiar comprobante del cobro" : "Subir comprobante del cobro"}
                    <input type="file" accept="image/*,application/pdf" className="hidden" disabled={busy === w.id} onChange={(e) => e.target.files?.[0] && uploadProof(w.id, e.target.files[0])} />
                  </label>
                )}
                {canClose && confirm?.id !== w.id && (
                  <>
                    <button type="button" disabled={waitingPickup} title={waitingPickup ? "Bodega todavía no confirma lo que trajo el motorizado" : ""} className="rounded border border-teal bg-teal px-2.5 py-1 font-bold text-navy cursor-pointer disabled:opacity-50" onClick={() => setConfirm({ id: w.id, action: "received" })}>
                      Se entregó al cliente
                    </button>
                    <button type="button" className="rounded border border-rule px-2.5 py-1 font-semibold cursor-pointer" onClick={() => setConfirm({ id: w.id, action: "notDelivered" })}>
                      No se pudo entregar
                    </button>
                    {waitingPickup && <span className="text-gold text-[11.5px]">Primero bodega confirma lo que trajo el motorizado.</span>}
                  </>
                )}
                {confirm?.id === w.id && (
                  <span className="flex flex-wrap items-center gap-2 bg-cloud border border-rule rounded px-2 py-1">
                    {confirm.action === "cancel"
                      ? "¿Cancelar esta garantía? Bryan ya no la verá y no sale nada de bodega."
                      : confirm.action === "received"
                      ? "¿Confirmas que el cliente recibió la garantía? Se habilita el pago del flete."
                      : "¿Confirmas que NO se pudo entregar? La mercadería vuelve a bodega y el flete igual se paga."}
                    <button type="button" disabled={busy === w.id} className="rounded border border-gold bg-gold px-2 py-0.5 font-bold text-navy cursor-pointer" onClick={() => act(w.id, confirm.action)}>
                      {busy === w.id ? "Guardando…" : "Sí, confirmar"}
                    </button>
                    <button type="button" className="text-steel cursor-pointer" onClick={() => setConfirm(null)}>Cancelar</button>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
