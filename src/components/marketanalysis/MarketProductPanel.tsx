"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, CheckCircle2, XCircle, Sparkles } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";
import { formatDateTime } from "@/lib/formatDateTime";

type SupplierOption = { id: string; name: string; paymentMode: "PREPAGO" | "CREDITO" };

type SupplierPrice = { id: string; batchCost: number; batchUnits: number; freightCost: number | null; isPrimary: boolean; supplier: { id: string; name: string; paymentMode?: "PREPAGO" | "CREDITO" } };

type Proposal = {
  id: string;
  code: string;
  productName: string;
  referenceImageUrl: string;
  description: string | null;
  platform: "DROPI" | "ROCKET" | "BOTH";
  competitorId: string | null;
  competitorPrice: number | null;
  competitorBodegaName: string | null;
  competitorProductName: string | null;
  noCompetitorData: boolean;
  discoverySourceNote: string | null;
  insuranceRatePercent: number;
  fulfillmentCost: number;
  marginPercent: number;
  calculatedSalePrice: number;
  status: "PENDING_APPROVAL" | "REJECTED" | "APPROVED";
  rejectReason: string | null;
  proposedAt: string;
  proposedBy: { name: string } | null;
  reviewedAt: string | null;
  reviewedBy: { name: string } | null;
  bodega: "MKT_DAMIAN" | "MKT_PROVEDIX" | "MKT_SHANGHAI" | null;
  isPublic: boolean | null;
  dropiProductId: string | null;
  publishedAt: string | null;
  publishedBy: { name: string } | null;
  brandedAt: string | null;
  brandedBy: { name: string } | null;
  chosenSupplier: { id: string; name: string; paymentMode?: "PREPAGO" | "CREDITO" } | null;
  readyToBuyAt: string | null;
  supplierPrices: SupplierPrice[];
  traceability?: { totalMinutes: number | null };
  suggestedSupplierId?: string | null;
};

const BODEGA_LABELS: Record<string, string> = {
  MKT_DAMIAN: "Importadora Damián",
  MKT_PROVEDIX: "Provedix",
  MKT_SHANGHAI: "Importadora Shanghai",
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function computePreviewPrice(batchCost: number, batchUnits: number, freightCost: number, insurance: number, fulfillment: number, margin: number) {
  if (!batchCost || !batchUnits || margin >= 100) return null;
  const unitCost = ((batchCost + (freightCost || 0)) * (1 + insurance / 100)) / batchUnits;
  return (unitCost + fulfillment) / (1 - margin / 100);
}

type Tab = "proponer" | "aprobacion" | "publicar" | "brandear" | "trazabilidad";

export function MarketProductPanel({
  canPropose,
  canReview,
  canActOnReview,
  canPublish,
  canBrand,
  canDecidePurchase,
}: {
  canPropose: boolean;
  canReview: boolean;
  canActOnReview: boolean;
  canPublish: boolean;
  canBrand: boolean;
  canDecidePurchase: boolean;
}) {
  const tabs: { key: Tab; label: string }[] = [
    ...(canPropose ? [{ key: "proponer" as Tab, label: "Proponer" }] : []),
    ...(canReview ? [{ key: "aprobacion" as Tab, label: "Aprobación" }] : []),
    ...(canPublish ? [{ key: "publicar" as Tab, label: "Publicar en Dropi" }] : []),
    ...(canBrand ? [{ key: "brandear" as Tab, label: "Brandear" }] : []),
    ...(canReview ? [{ key: "trazabilidad" as Tab, label: "Trazabilidad" }] : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? "proponer");

  if (tabs.length === 0) return <div className="text-steel text-[13.5px]">No tienes acceso a Análisis de Mercado.</div>;

  return (
    <div>
      <div className="flex gap-5.5 border-b border-rule mb-5.5 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`pb-2.5 text-[13px] font-semibold border-b-2 cursor-pointer whitespace-nowrap ${tab === t.key ? "text-ink border-teal" : "text-steel border-transparent hover:text-ink"}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "proponer" && <ProposeForm />}
      {tab === "aprobacion" && <ReviewQueue canAct={canActOnReview} />}
      {tab === "publicar" && <PublishQueue />}
      {tab === "brandear" && <BrandQueue />}
      {tab === "trazabilidad" && <TraceabilityView canDecidePurchase={canDecidePurchase} />}
    </div>
  );
}

// Confirmado 2026-09-10, pedido explícito del usuario: con muchos
// proveedores, el <select> nativo obligaba a scrollear una lista larga —
// esto filtra en vivo por lo que se va escribiendo, mismo patrón de
// buscar+elegir que ya usan ProductMatchPicker/ClientMatchPicker.
function SupplierSelect({ suppliers, value, onChange }: { suppliers: SupplierOption[]; value: string; onChange: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = suppliers.find((s) => s.id === value) ?? null;
  const filtered = query.trim() ? suppliers.filter((s) => s.name.toLowerCase().includes(query.toLowerCase())) : suppliers;

  if (selected && !open) {
    return (
      <div className="flex items-center justify-between gap-2 rounded border border-rule px-2.5 py-1.5 text-[13px] mb-2 bg-surface">
        <span className="truncate">{selected.name}{selected.paymentMode === "CREDITO" ? " (crédito)" : ""}</span>
        <button type="button" className="text-[11px] font-semibold text-blue cursor-pointer shrink-0" onClick={() => { setOpen(true); setQuery(""); }}>
          Cambiar
        </button>
      </div>
    );
  }

  return (
    <div className="relative mb-2">
      <input
        className="w-full rounded border border-rule px-2.5 py-1.5 text-[13px]"
        placeholder="Buscar proveedor…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded border border-rule bg-surface shadow-lg">
          {filtered.length === 0 && <div className="px-2.5 py-2 text-[12px] text-steel">Sin resultados.</div>}
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              className="w-full text-left px-2.5 py-1.5 text-[13px] hover:bg-cloud cursor-pointer"
              onMouseDown={(e) => { e.preventDefault(); onChange(s.id); setOpen(false); setQuery(""); }}
            >
              {s.name}{s.paymentMode === "CREDITO" ? " (crédito)" : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- Paso 1: Proponer (Jariel) ----------------
function ProposeForm() {
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [platform, setPlatform] = useState<"DROPI" | "ROCKET" | "BOTH">("DROPI");
  const [competitorId, setCompetitorId] = useState("");
  const [competitorPrice, setCompetitorPrice] = useState("");
  const [competitorBodegaName, setCompetitorBodegaName] = useState("");
  const [competitorProductName, setCompetitorProductName] = useState("");
  const [noCompetitorData, setNoCompetitorData] = useState(false);
  const [discoverySourceNote, setDiscoverySourceNote] = useState("");
  const [insurance, setInsurance] = useState("6");
  const [fulfillment, setFulfillment] = useState("0.75");
  const [margin, setMargin] = useState("20");
  const [primarySupplierId, setPrimarySupplierId] = useState("");
  const [primaryCost, setPrimaryCost] = useState("");
  const [primaryUnits, setPrimaryUnits] = useState("100");
  const [primaryFreight, setPrimaryFreight] = useState("");
  const [addSecondary, setAddSecondary] = useState(false);
  const [secondarySupplierId, setSecondarySupplierId] = useState("");
  const [secondaryCost, setSecondaryCost] = useState("");
  const [secondaryUnits, setSecondaryUnits] = useState("100");
  const [secondaryFreight, setSecondaryFreight] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/purchase-suppliers").then((r) => (r.ok ? r.json() : [])).then(setSuppliers).catch(() => setSuppliers([]));
  }, []);

  const showsCompetitor = platform !== "ROCKET" && !noCompetitorData;
  const preview = computePreviewPrice(Number(primaryCost), Number(primaryUnits), Number(primaryFreight), Number(insurance), Number(fulfillment), Number(margin));

  async function uploadImage(file: File) {
    setUploading(true);
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "market-product-reference");
    setUploading(false);
    if (!uploaded.ok) { setErr(uploaded.error); return; }
    setImageUrl(uploaded.url);
  }

  // Confirmado 2026-09-10, pedido de Jariel: arrastrar y soltar la imagen
  // referencial, mismo patrón ya usado en Control de Compras (cotización,
  // orden de compra) — también deja pegar con Ctrl+V.
  const { onPaste, onMouseEnter, onMouseLeave, onDragOver, onDragLeave, onDrop, isDragOver } = usePasteFile((file) => uploadImage(file));

  async function submit() {
    setErr(""); setOk("");
    if (!productName || !imageUrl || !primarySupplierId || !primaryCost || !primaryUnits) {
      setErr("Completa nombre, imagen, y el proveedor obligatorio con su costo y unidades.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/market-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productName,
        description: description || undefined,
        referenceImageUrl: imageUrl,
        platform,
        competitorId: showsCompetitor ? competitorId || undefined : undefined,
        competitorPrice: showsCompetitor && competitorPrice ? Number(competitorPrice) : undefined,
        competitorBodegaName: showsCompetitor ? competitorBodegaName || undefined : undefined,
        competitorProductName: showsCompetitor ? competitorProductName || undefined : undefined,
        noCompetitorData,
        discoverySourceNote: noCompetitorData ? discoverySourceNote || undefined : undefined,
        insuranceRatePercent: Number(insurance),
        fulfillmentCost: Number(fulfillment),
        marginPercent: Number(margin),
        primarySupplierPrice: { supplierId: primarySupplierId, batchCost: Number(primaryCost), batchUnits: Number(primaryUnits), freightCost: primaryFreight ? Number(primaryFreight) : undefined },
        secondarySupplierPrice: addSecondary && secondarySupplierId && secondaryCost && secondaryUnits
          ? { supplierId: secondarySupplierId, batchCost: Number(secondaryCost), batchUnits: Number(secondaryUnits), freightCost: secondaryFreight ? Number(secondaryFreight) : undefined }
          : undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? "No se pudo enviar."); return; }
    setOk("Propuesta enviada a Bryan para aprobación.");
    setProductName(""); setDescription(""); setImageUrl(""); setCompetitorId(""); setCompetitorPrice(""); setCompetitorBodegaName(""); setCompetitorProductName("");
    setNoCompetitorData(false); setDiscoverySourceNote("");
    setPrimarySupplierId(""); setPrimaryCost(""); setPrimaryUnits("100"); setPrimaryFreight(""); setAddSecondary(false);
  }

  return (
    <div className="max-w-xl">
      <div className="mb-3">
        <label className="text-[12px] font-semibold text-steel">Nombre comercial</label>
        <input className="w-full rounded border border-rule px-2.5 py-1.5 text-[13px] mt-1" value={productName} onChange={(e) => setProductName(e.target.value)} />
      </div>
      <div className="mb-3">
        <label className="text-[12px] font-semibold text-steel">Imagen referencial</label>
        {imageUrl ? (
          <div className="mt-1.5 flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="Imagen referencial" className="w-16 h-16 object-cover rounded border border-rule cursor-pointer" />
            <div className="text-[12px] text-teal">
              Imagen subida ✓ <button type="button" className="text-steel underline decoration-dotted ml-1 cursor-pointer" onClick={() => setImageUrl("")}>Cambiar</button>
              <div className="text-steel text-[11px] mt-0.5">Doble clic en la imagen para verla más grande</div>
            </div>
          </div>
        ) : (
          <div
            tabIndex={0}
            onPaste={onPaste}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`mt-1 flex flex-col items-center justify-center gap-1 border-[1.5px] border-dashed rounded-md py-3 text-[12px] text-steel cursor-pointer focus:outline-none ${
              isDragOver ? "border-teal bg-teal/5" : "border-rule hover:border-teal focus:border-teal"
            }`}
          >
            <span className="flex items-center gap-1.5">
              {uploading ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={13} />}
              Pega o arrastra la imagen aquí (Ctrl+V)
            </span>
            <button type="button" className="text-[10.5px] underline decoration-dotted opacity-80 hover:opacity-100 cursor-pointer" onClick={() => fileRef.current?.click()}>
              o selecciona un archivo
            </button>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])} />
      </div>
      <div className="mb-3">
        <label className="text-[12px] font-semibold text-steel">Descripción (opcional)</label>
        <textarea className="w-full rounded border border-rule px-2.5 py-1.5 text-[13px] mt-1" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="mb-3">
        <label className="text-[12px] font-semibold text-steel">¿En qué plataforma se vende?</label>
        <div className="flex gap-1.5 mt-1">
          {(["DROPI", "ROCKET", "BOTH"] as const).map((p) => (
            <button key={p} type="button" className={`flex-1 rounded border py-1.5 text-[12px] font-semibold cursor-pointer ${platform === p ? "border-teal bg-teal/10 text-teal" : "border-rule text-steel"}`} onClick={() => setPlatform(p)}>
              {p === "DROPI" ? "Dropi" : p === "ROCKET" ? "Rocket" : "Ambas"}
            </button>
          ))}
        </div>
      </div>
      {platform !== "ROCKET" && (
        <label className="mb-3 flex items-start gap-2 text-[12px] text-steel cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={noCompetitorData} onChange={(e) => setNoCompetitorData(e.target.checked)} />
          <span>Este producto no tiene datos de Dropi/Dropkiller/Rocket — me lo recomendó un proveedor</span>
        </label>
      )}
      {showsCompetitor && (
        <div className="mb-3 bg-cloud border border-rule rounded-md p-3">
          <div className="text-[12px] font-semibold text-steel mb-2">ID ganador de la competencia (Dropi)</div>
          <input className="w-full rounded border border-rule px-2.5 py-1.5 text-[13px] mb-2" placeholder="ID de la competencia" value={competitorId} onChange={(e) => setCompetitorId(e.target.value)} />
          <input className="w-full rounded border border-rule px-2.5 py-1.5 text-[13px] mb-2" placeholder="Nombre del producto referencial" value={competitorProductName} onChange={(e) => setCompetitorProductName(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <input className="rounded border border-rule px-2.5 py-1.5 text-[13px]" placeholder="Precio de venta" type="number" step="0.01" value={competitorPrice} onChange={(e) => setCompetitorPrice(e.target.value)} />
            <input className="rounded border border-rule px-2.5 py-1.5 text-[13px]" placeholder="Bodega vendedora" value={competitorBodegaName} onChange={(e) => setCompetitorBodegaName(e.target.value)} />
          </div>
        </div>
      )}
      {platform !== "ROCKET" && noCompetitorData && (
        <div className="mb-3 bg-cloud border border-rule rounded-md p-3">
          <div className="text-[12px] font-semibold text-steel mb-2">¿Cómo lo encontraste? (opcional)</div>
          <input
            className="w-full rounded border border-rule px-2.5 py-1.5 text-[13px]"
            placeholder="Ej. Recomendado por [proveedor] en su canal de Telegram"
            value={discoverySourceNote}
            onChange={(e) => setDiscoverySourceNote(e.target.value)}
          />
        </div>
      )}

      <div className="mb-3 bg-cloud border border-rule rounded-md p-3">
        <div className="text-[12px] font-semibold text-steel mb-2">Proveedor 1 (obligatorio)</div>
        <SupplierSelect suppliers={suppliers} value={primarySupplierId} onChange={setPrimarySupplierId} />
        <div className="grid grid-cols-3 gap-2">
          <input className="rounded border border-rule px-2.5 py-1.5 text-[13px]" placeholder="Costo unitario (USD)" type="number" step="0.01" value={primaryCost} onChange={(e) => setPrimaryCost(e.target.value)} />
          <input className="rounded border border-rule px-2.5 py-1.5 text-[13px]" placeholder="Unidades del lote" type="number" value={primaryUnits} onChange={(e) => setPrimaryUnits(e.target.value)} />
          <input className="rounded border border-rule px-2.5 py-1.5 text-[13px]" placeholder="Flete (si aplica)" type="number" step="0.01" value={primaryFreight} onChange={(e) => setPrimaryFreight(e.target.value)} />
        </div>
      </div>

      {addSecondary ? (
        <div className="mb-3 bg-cloud border border-rule rounded-md p-3">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[12px] font-semibold text-steel">Proveedor 2 (opcional)</span>
            <button type="button" className="text-[11px] text-steel underline decoration-dotted cursor-pointer" onClick={() => setAddSecondary(false)}>Quitar</button>
          </div>
          <SupplierSelect suppliers={suppliers} value={secondarySupplierId} onChange={setSecondarySupplierId} />
          <div className="grid grid-cols-3 gap-2">
            <input className="rounded border border-rule px-2.5 py-1.5 text-[13px]" placeholder="Costo unitario (USD)" type="number" step="0.01" value={secondaryCost} onChange={(e) => setSecondaryCost(e.target.value)} />
            <input className="rounded border border-rule px-2.5 py-1.5 text-[13px]" placeholder="Unidades del lote" type="number" value={secondaryUnits} onChange={(e) => setSecondaryUnits(e.target.value)} />
            <input className="rounded border border-rule px-2.5 py-1.5 text-[13px]" placeholder="Flete (si aplica)" type="number" step="0.01" value={secondaryFreight} onChange={(e) => setSecondaryFreight(e.target.value)} />
          </div>
        </div>
      ) : (
        <button type="button" className="mb-3 text-[12px] text-blue font-semibold cursor-pointer" onClick={() => setAddSecondary(true)}>+ Agregar 2° proveedor (opcional)</button>
      )}

      <div className="mb-4 bg-surface border border-rule rounded-md p-3">
        <div className="text-[12px] font-semibold text-steel mb-2">Calculadora</div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[12px] text-steel">Fulfillment:</span>
          <button type="button" className={`rounded border px-2 py-1 text-[11.5px] font-semibold cursor-pointer ${fulfillment === "0.75" ? "border-teal bg-teal/10 text-teal" : "border-rule text-steel"}`} onClick={() => setFulfillment("0.75")}>$0.75 (default)</button>
          <button type="button" className={`rounded border px-2 py-1 text-[11.5px] font-semibold cursor-pointer ${fulfillment === "0.50" ? "border-teal bg-teal/10 text-teal" : "border-rule text-steel"}`} onClick={() => setFulfillment("0.50")}>$0.50 (chico)</button>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <label className="text-[11px] text-steel">% de seguro</label>
            <input className="w-full rounded border border-rule px-2 py-1 text-[13px]" type="number" step="0.1" value={insurance} onChange={(e) => setInsurance(e.target.value)} />
          </div>
          <div>
            <label className="text-[11px] text-steel">Margen mínimo %</label>
            <input className="w-full rounded border border-rule px-2 py-1 text-[13px]" type="number" step="0.1" value={margin} onChange={(e) => setMargin(e.target.value)} />
          </div>
        </div>
        <div className="text-[13px] font-bold text-ink">
          Precio de Dropi (estimado): {preview !== null ? money(preview) : "—"}
        </div>
      </div>

      {err && <div className="text-red text-[12.5px] mb-2">{err}</div>}
      {ok && <div className="text-teal text-[12.5px] mb-2">{ok}</div>}
      <button type="button" disabled={busy} className="rounded border border-blue bg-blue px-4 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={submit}>
        Enviar a Bryan
      </button>
    </div>
  );
}

// ---------------- Paso 2: Aprobación (Bryan) ----------------
function ReviewQueue({ canAct }: { canAct: boolean }) {
  const [rows, setRows] = useState<Proposal[] | null>(null);
  const [bodega, setBodega] = useState<Record<string, string>>({});
  const [isPublic, setIsPublic] = useState<Record<string, boolean>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/market-products?view=review").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }
  useEffect(load, []);

  async function approve(id: string) {
    if (!bodega[id]) { setErr("Elige la bodega antes de aprobar."); return; }
    setErr(""); setBusy(id);
    const res = await fetch(`/api/market-products/${id}/review`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "APPROVED", bodega: bodega[id], isPublic: !!isPublic[id] }),
    });
    setBusy(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? "No se pudo aprobar."); return; }
    load();
  }
  async function reject(id: string) {
    if (!rejectReason.trim()) return;
    setErr(""); setBusy(id);
    const res = await fetch(`/api/market-products/${id}/review`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "REJECTED", rejectReason }),
    });
    setBusy(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? "No se pudo rechazar."); return; }
    setRejecting(null); setRejectReason(""); load();
  }

  if (rows === null) return <div className="text-steel text-[13px]">Cargando…</div>;
  if (rows.length === 0) return <div className="text-steel text-[13.5px]">No hay propuestas pendientes.</div>;

  return (
    <div className="flex flex-col gap-3">
      {err && <div className="text-red text-[12.5px]">{err}</div>}
      {rows.map((p) => (
        <div key={p.id} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="flex items-start gap-3 mb-2">
            <img src={p.referenceImageUrl} alt="" className="w-16 h-16 rounded object-cover shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-[13.5px]">{p.code} — {p.productName}</div>
              <div className="text-[12px] text-steel">{p.platform === "BOTH" ? "Dropi + Rocket" : p.platform === "DROPI" ? "Dropi" : "Rocket"} · Propuesto por {p.proposedBy?.name ?? "—"} · {formatDateTime(p.proposedAt)}</div>
              <div className="text-[13px] font-bold text-ink mt-1">Precio de Dropi: {money(p.calculatedSalePrice)}</div>
            </div>
          </div>
          <ul className="text-[12px] text-steel mb-2">
            {p.supplierPrices.map((sp) => (
              <li key={sp.id}>{sp.isPrimary ? "1° " : "2° "}{sp.supplier.name}: {money(sp.batchCost)} por {sp.batchUnits} un.{sp.freightCost ? ` + flete ${money(sp.freightCost)}` : ""}</li>
            ))}
          </ul>
          {p.competitorProductName && (
            <div className="text-[12px] text-steel mb-2">Competencia: {p.competitorProductName} — {p.competitorPrice ? money(p.competitorPrice) : "—"} ({p.competitorBodegaName})</div>
          )}
          {p.noCompetitorData && (
            <div className="text-[12px] text-yellow mb-2">
              Sin datos de respaldo — recomendado por proveedor{p.discoverySourceNote ? `: ${p.discoverySourceNote}` : ""}
            </div>
          )}
          {canAct && (
            rejecting === p.id ? (
              <div>
                <textarea className="w-full rounded border border-rule px-2.5 py-1.5 text-[13px] mb-2" placeholder="Motivo del rechazo" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                <div className="flex gap-2">
                  <button type="button" disabled={busy === p.id} className="rounded border border-red bg-red px-3 py-1.5 text-[12px] font-semibold text-white cursor-pointer" onClick={() => reject(p.id)}>Confirmar rechazo</button>
                  <button type="button" className="text-steel text-[12px] cursor-pointer" onClick={() => setRejecting(null)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <select className="rounded border border-rule px-2 py-1.5 text-[12px]" value={bodega[p.id] ?? ""} onChange={(e) => setBodega((b) => ({ ...b, [p.id]: e.target.value }))}>
                  <option value="">Bodega…</option>
                  <option value="MKT_PROVEDIX">Provedix</option>
                  <option value="MKT_DAMIAN">Importadora Damián</option>
                  <option value="MKT_SHANGHAI">Importadora Shanghai</option>
                </select>
                <label className="flex items-center gap-1 text-[12px] text-steel">
                  <input type="checkbox" checked={!!isPublic[p.id]} onChange={(e) => setIsPublic((s) => ({ ...s, [p.id]: e.target.checked }))} /> Público
                </label>
                <button type="button" disabled={busy === p.id} className="flex items-center gap-1 rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => approve(p.id)}>
                  <CheckCircle2 size={13} /> Aprobar
                </button>
                <button type="button" className="flex items-center gap-1 rounded border border-rule px-3 py-1.5 text-[12px] font-semibold text-steel cursor-pointer" onClick={() => setRejecting(p.id)}>
                  <XCircle size={13} /> Rechazar
                </button>
              </div>
            )
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------- Paso 3: Publicar en Dropi (Heidy) ----------------
function PublishQueue() {
  const [rows, setRows] = useState<Proposal[] | null>(null);
  const [dropiId, setDropiId] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/market-products?view=publish").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }
  useEffect(load, []);

  async function publish(id: string) {
    if (!dropiId[id]?.trim()) { setErr("Falta el ID de Dropi."); return; }
    setErr(""); setBusy(id);
    const res = await fetch(`/api/market-products/${id}/publish`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dropiProductId: dropiId[id].trim(), quantity: 100 }),
    });
    setBusy(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? "No se pudo publicar."); return; }
    load();
  }

  if (rows === null) return <div className="text-steel text-[13px]">Cargando…</div>;
  if (rows.length === 0) return <div className="text-steel text-[13.5px]">No hay productos aprobados esperando publicarse.</div>;

  return (
    <div className="flex flex-col gap-3">
      {err && <div className="text-red text-[12.5px]">{err}</div>}
      {rows.map((p) => (
        <div key={p.id} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="flex items-start gap-3 mb-2">
            <img src={p.referenceImageUrl} alt="" className="w-16 h-16 rounded object-cover shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-[13.5px]">{p.code} — {p.productName}</div>
              <div className="text-[12px] text-steel">Bodega: {BODEGA_LABELS[p.bodega ?? ""] ?? "—"} · {p.isPublic ? "Público" : "Privado"} · Cantidad por defecto: 100</div>
              <div className="text-[13px] font-bold text-ink mt-1">Precio de Dropi: {money(p.calculatedSalePrice)}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <input className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[13px]" placeholder="ID que te dio Dropi" value={dropiId[p.id] ?? ""} onChange={(e) => setDropiId((s) => ({ ...s, [p.id]: e.target.value }))} />
            <button type="button" disabled={busy === p.id} className="rounded border border-teal bg-teal px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => publish(p.id)}>
              Confirmar publicado
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------- Paso 4: Brandear (Robert) ----------------
function BrandQueue() {
  const [rows, setRows] = useState<Proposal[] | null>(null);
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function load() {
    fetch("/api/market-products?view=brand").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }
  useEffect(load, []);

  async function uploadPhoto(id: string, file: File) {
    setUploading(id);
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "market-product-branding");
    setUploading(null);
    if (!uploaded.ok) { setErr(uploaded.error); return; }
    setPhotos((s) => ({ ...s, [id]: [...(s[id] ?? []), uploaded.url].slice(0, 3) }));
  }

  async function finish(id: string) {
    const list = photos[id] ?? [];
    if (list.length < 3) { setErr("Sube las 3 fotos reales antes de terminar."); return; }
    setErr(""); setBusy(id);
    const res = await fetch(`/api/market-products/${id}/brand`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photos: list }),
    });
    setBusy(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? "No se pudo terminar."); return; }
    load();
  }

  if (rows === null) return <div className="text-steel text-[13px]">Cargando…</div>;
  if (rows.length === 0) return <div className="text-steel text-[13.5px]">No hay productos publicados esperando brandeo.</div>;

  return (
    <div className="flex flex-col gap-3">
      {err && <div className="text-red text-[12.5px]">{err}</div>}
      {rows.map((p) => {
        const list = photos[p.id] ?? [];
        return (
          <div key={p.id} className="bg-surface border border-rule rounded-md p-3.5">
            <div className="font-semibold text-[13.5px] mb-1">{p.code} — {p.productName}</div>
            <div className="text-[12px] text-steel mb-2">Dropi ID: {p.dropiProductId} · Bodega: {BODEGA_LABELS[p.bodega ?? ""] ?? "—"}</div>
            <div className="flex gap-2 mb-2">
              {list.map((url, i) => <img key={i} src={url} alt="" className="w-14 h-14 rounded object-cover" />)}
              {list.length < 3 && (
                <button type="button" className="w-14 h-14 rounded border-[1.5px] border-dashed border-rule flex items-center justify-center text-steel cursor-pointer hover:border-teal" onClick={() => fileRefs.current[p.id]?.click()}>
                  {uploading === p.id ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={14} />}
                </button>
              )}
            </div>
            <input ref={(el) => { fileRefs.current[p.id] = el; }} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadPhoto(p.id, e.target.files[0])} />
            <button type="button" disabled={busy === p.id || list.length < 3} className="rounded border border-teal bg-teal px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => finish(p.id)}>
              Terminar brandeo ({list.length}/3)
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Paso 5: Trazabilidad + decisión de compra (Bryan) ----------------
function TraceabilityView({ canDecidePurchase }: { canDecidePurchase: boolean }) {
  const [rows, setRows] = useState<Proposal[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/market-products?view=traceability").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }
  useEffect(load, []);

  async function markReady(id: string) {
    const supplierId = chosen[id];
    if (!supplierId) { setErr("Elige el proveedor antes de marcar listo."); return; }
    setErr(""); setBusy(id);
    const res = await fetch(`/api/market-products/${id}/ready-to-buy`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chosenSupplierId: supplierId }),
    });
    setBusy(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? "No se pudo marcar."); return; }
    load();
  }

  if (rows === null) return <div className="text-steel text-[13px]">Cargando…</div>;
  if (rows.length === 0) return <div className="text-steel text-[13.5px]">No hay productos aprobados todavía.</div>;

  return (
    <div className="flex flex-col gap-3">
      {err && <div className="text-red text-[12.5px]">{err}</div>}
      {rows.map((p) => (
        <div key={p.id} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="font-semibold text-[13.5px] mb-2">{p.code} — {p.productName}</div>
          <ol className="text-[12.5px] text-steel space-y-0.5 mb-3">
            <li>1. Propuesto por {p.proposedBy?.name ?? "—"} — {formatDateTime(p.proposedAt)}</li>
            <li>2. Aprobado por {p.reviewedBy?.name ?? "—"} — {p.reviewedAt ? formatDateTime(p.reviewedAt) : "—"}</li>
            <li>3. Publicado por {p.publishedBy?.name ?? "—"} — {p.publishedAt ? formatDateTime(p.publishedAt) : "pendiente"}</li>
            <li>4. Brandeado por {p.brandedBy?.name ?? "—"} — {p.brandedAt ? formatDateTime(p.brandedAt) : "pendiente"}</li>
          </ol>
          {p.traceability?.totalMinutes != null && (
            <div className="text-[12px] font-semibold text-ink mb-3">Tiempo total: {Math.floor(p.traceability.totalMinutes / 60)}h {p.traceability.totalMinutes % 60}min</div>
          )}
          {canDecidePurchase && !p.readyToBuyAt && p.brandedAt && (
            <div className="flex flex-wrap items-center gap-2">
              <select className="rounded border border-rule px-2 py-1.5 text-[12px]" value={chosen[p.id] ?? p.suggestedSupplierId ?? ""} onChange={(e) => setChosen((c) => ({ ...c, [p.id]: e.target.value }))}>
                <option value="">Elige proveedor…</option>
                {p.supplierPrices.map((sp) => (
                  <option key={sp.supplier.id} value={sp.supplier.id}>
                    {sp.supplier.name}{sp.supplier.id === p.suggestedSupplierId ? " (más barato)" : ""}{sp.supplier.paymentMode === "CREDITO" ? " — crédito" : ""}
                  </option>
                ))}
              </select>
              <button type="button" disabled={busy === p.id} className="flex items-center gap-1 rounded border border-blue bg-blue px-3 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => markReady(p.id)}>
                <Sparkles size={13} /> Marcar listo para comprar
              </button>
            </div>
          )}
          {p.readyToBuyAt && <div className="text-[12px] text-teal font-semibold">Listo para comprar con {p.chosenSupplier?.name} — {formatDateTime(p.readyToBuyAt)}</div>}
        </div>
      ))}
    </div>
  );
}
