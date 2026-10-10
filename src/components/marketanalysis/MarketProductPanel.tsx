"use client";

import { useEffect, useRef, useState } from "react";
import { B2BAdvisorName } from "@/components/shared/B2BAdvisorName";
import { Upload, CheckCircle2, XCircle, Sparkles } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";
import { formatDateTime } from "@/lib/formatDateTime";
import { useFormDraft } from "@/lib/useFormDraft";
import { TabGuide } from "@/components/shared/TabGuide";
import { ExpandableName } from "@/components/ui/ExpandableName";
import { SupplierStockoutPanel } from "@/components/marketanalysis/SupplierStockoutPanel";
import { SuddenDemandPanel } from "@/components/marketanalysis/SuddenDemandPanel";
import { VariantSalesPanel } from "@/components/marketanalysis/VariantSalesPanel";
import { MaxPurchasePrice } from "@/components/marketanalysis/MaxPurchasePrice";
import { CopyDropiPrice } from "@/components/shared/CopyDropiPrice";
import { DropiPriceChangesQueue } from "./DropiPriceChangesQueue";
import { computePreviewPrice, computeCompetitorComparison } from "./PriceCalculator";

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
  rejectionSeenAt?: string | null;
  proposedAt: string;
  proposedBy: { name: string } | null;
  reviewedAt: string | null;
  reviewedBy: { name: string } | null;
  bodega: "MKT_DAMIAN" | "MKT_PROVEDIX" | "MKT_SHANGHAI" | null;
  isPublic: boolean | null;
  rocketOnly?: boolean;
  rocketProductId?: string | null;
  rocketSku?: string | null;
  rocketSkuAt?: string | null;
  rocketSkuBy?: { name: string } | null;
  publicRequestedAt?: string | null;
  madePublicAt?: string | null;
  madePublicBy?: { name: string } | null;
  rocketSkuOverdue?: boolean;
  dropiProductId: string | null;
  publishedAt: string | null;
  publishedBy: { name: string } | null;
  brandedAt: string | null;
  brandedBy: { name: string } | null;
  chosenSupplier: { id: string; name: string; paymentMode?: "PREPAGO" | "CREDITO" } | null;
  readyToBuyAt: string | null;
  kardexReleasedAt: string | null;
  kardexReleasedBy: { name: string } | null;
  kardexPendingUnits?: number;
  rejectedPurchase?: { code: string | null; reason: string | null; at: string | null } | null;
  boughtAt?: string | null;
  catalogItem: { id: string; name: string; photos: string[]; awaitingDropiId?: boolean } | null;
  supplierPrices: SupplierPrice[];
  traceability?: { totalMinutes: number | null };
  suggestedSupplierId?: string | null;
  purchasesInTransit?: string[];
};

const BODEGA_LABELS: Record<string, string> = {
  MKT_DAMIAN: "Importadora Damián",
  MKT_PROVEDIX: "Provedix",
  MKT_SHANGHAI: "Importadora Shanghai",
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

type Tab = "proponer" | "ganadores" | "sinstock" | "despiertan" | "variantes" | "mispropuestas" | "listoparacomprar" | "consulta" | "aprobacion" | "publicar" | "mispublicados" | "rocket" | "trazabilidad";

export function MarketProductPanel({
  canPropose,
  canReview,
  canActOnReview,
  canPublish,
  canUploadRocketSku = false,
  canDecidePurchase,
  canViewB2BPricing,
  canViewB2CPricing,
  canReportStockout = false,
  canResolveStockout = false,
}: {
  canPropose: boolean;
  canReview: boolean;
  canActOnReview: boolean;
  canPublish: boolean;
  // Aprobado por Bryan 2026-10-10: "Solo Rocket por ahora" — hoy Yair.
  canUploadRocketSku?: boolean;
  canDecidePurchase: boolean;
  canViewB2BPricing: boolean;
  canViewB2CPricing: boolean;
  // Confirmado 2026-09-23, pedido de Jariel: reportar (hoy Jariel, vía
  // canManagePurchases) y resolver (hoy Heidy/Bryan) un producto sin stock
  // de proveedor — ver SupplierStockoutPanel.
  canReportStockout?: boolean;
  canResolveStockout?: boolean;
}) {
  const tabs: { key: Tab; label: string }[] = [
    ...(canPropose ? [{ key: "proponer" as Tab, label: "Proponer" }] : []),
    // Confirmado 2026-09-22, pedido de Jariel: su lista de productos que ve
    // ganando en la competencia pero que todavía ningún proveedor tiene.
    ...(canPropose ? [{ key: "ganadores" as Tab, label: "Ganadores no encontrados" }] : []),
    // Confirmado 2026-09-23, pedido de Jariel: lo contrario de "Ganadores" —
    // un producto que YA se vende pero que dejó de conseguirse con
    // cualquier proveedor. Visible para todo el equipo (mismo criterio que
    // Ganadores); reportar/resolver quedan gateados aparte, dentro del panel.
    ...(canPropose || canResolveStockout ? [{ key: "sinstock" as Tab, label: "Sin stock de proveedor" }] : []),
    // Confirmado 2026-09-29, pedido de Daniel: productos que casi no salían y
    // de pronto salen 4 o más en un día (Jariel deja su nota ahí).
    ...(canPropose || canResolveStockout || canReview ? [{ key: "despiertan" as Tab, label: "Productos que despiertan" }] : []),
    // Pedido del usuario 2026-10-05 (etapa 1 de variantes): qué color / talla
    // se vende más de cada producto. Mismo público que "Productos que despiertan".
    ...(canPropose || canResolveStockout || canReview ? [{ key: "variantes" as Tab, label: "Ventas por variante" }] : []),
    // Confirmado 2026-09-10, pedido de Jariel: seguimiento de sus propios
    // productos propuestos (en qué van, quién los aprobó/rechazó, etc.) —
    // antes GET ?view=mine existía en la API pero ninguna pantalla lo
    // consumía.
    ...(canPropose ? [{ key: "mispropuestas" as Tab, label: "Mis propuestas" }] : []),
    // Confirmado 2026-09-14, pedido explícito del usuario: antes, cuando
    // Bryan marcaba "listo para comprar", a Jariel solo le llegaba un aviso
    // pero no tenía ninguna pantalla para actuar — tenía que acordarse solo
    // y armar la solicitud de compra de cero. Ahora ve la lista acá mismo y
    // puede saltar directo a Control de Compras con el producto y el
    // proveedor ya elegidos.
    ...(canPropose ? [{ key: "listoparacomprar" as Tab, label: "Listo para comprar" }] : []),
    // Confirmado 2026-09-14: solo consulta de precio de venta (B2B o B2C
    // según quién pregunta) para quien vende por Ventas Externas — sin
    // acceso a los costos crudos de la calculadora de Jariel.
    ...(canViewB2BPricing || canViewB2CPricing ? [{ key: "consulta" as Tab, label: "Consulta de precios" }] : []),
    ...(canReview ? [{ key: "aprobacion" as Tab, label: "Aprobación" }] : []),
    ...(canPublish ? [{ key: "publicar" as Tab, label: "Publicar en Dropi" }] : []),
    // Confirmado 2026-09-23, pedido de Heidy: historial de lo que ya publicó.
    ...(canPublish ? [{ key: "mispublicados" as Tab, label: "Mis publicados" }] : []),
    ...(canUploadRocketSku ? [{ key: "rocket" as Tab, label: "Subir a Rocket" }] : []),
    ...(canReview ? [{ key: "trazabilidad" as Tab, label: "Trazabilidad" }] : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? "proponer");
  const [proposePrefill, setProposePrefill] = useState<ProposePrefill | null>(null);

  // Confirmado 2026-09-23: el pendiente de Inicio de "Sin stock de
  // proveedor" enlaza con ?ptab=sinstock — mismo patrón que ya usa
  // PurchaseControlPanel para sus links de Pendientes.
  useEffect(() => {
    const ptab = new URLSearchParams(window.location.search).get("ptab");
    if (ptab && tabs.some((t) => t.key === ptab)) setTab(ptab as Tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      {tab === "proponer" && (
        <ProposeForm
          key={proposePrefill?.unfoundId ?? "new"}
          prefill={proposePrefill}
          onClearPrefill={() => setProposePrefill(null)}
        />
      )}
      {tab === "ganadores" && (
        <UnfoundWinnersView
          onPropose={(p) => { setProposePrefill(p); setTab("proponer"); }}
        />
      )}
      {tab === "sinstock" && <SupplierStockoutPanel canReport={canReportStockout} canResolve={canResolveStockout} />}
      {tab === "despiertan" && <SuddenDemandPanel />}
      {tab === "variantes" && <VariantSalesPanel />}
      {tab === "mispropuestas" && <MyProposalsView />}
      {tab === "listoparacomprar" && <ReadyToBuyQueue />}
      {tab === "consulta" && <PricingConsultaTable />}
      {tab === "aprobacion" && <ReviewQueue canAct={canActOnReview} />}
      {tab === "publicar" && (
        <>
          <DropiPriceChangesQueue />
          <MakePublicQueue />
          <CatalogMissingIdQueue />
          <PublishQueue />
        </>
      )}
      {tab === "mispublicados" && <PublishedHistoryView />}
      {tab === "rocket" && <RocketUploadView />}
      {tab === "trazabilidad" && <TraceabilityView canDecidePurchase={canDecidePurchase} canCancel={canReview} canRequestPublic={canActOnReview} />}
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

type ProposeDraftData = {
  productName: string;
  description: string;
  imageUrl: string;
  platform: "DROPI" | "ROCKET" | "BOTH";
  competitorId: string;
  competitorPrice: string;
  competitorBodegaName: string;
  competitorProductName: string;
  noCompetitorData: boolean;
  discoverySourceNote: string;
  insurance: string;
  fulfillment: string;
  margin: string;
  primarySupplierId: string;
  primaryCost: string;
  primaryUnits: string;
  primaryFreight: string;
  primaryNoFreight: boolean;
};
function isProposeDraftEmpty(d: ProposeDraftData) {
  return (
    !d.productName.trim() &&
    !d.description.trim() &&
    !d.imageUrl &&
    !d.competitorId.trim() &&
    !d.competitorPrice.trim() &&
    !d.competitorBodegaName.trim() &&
    !d.competitorProductName.trim() &&
    !d.discoverySourceNote.trim() &&
    !d.primarySupplierId &&
    !d.primaryCost.trim() &&
    !d.primaryFreight.trim()
  );
}

// Datos que llegan desde "Pasar a Proponer" en Ganadores no encontrados.
type ProposePrefill = {
  unfoundId: string;
  productName: string;
  imageUrl: string;
  competitorId: string;
  competitorPrice: string;
  supplierId: string;
};

// ---------------- Paso 1: Proponer (Jariel) ----------------
function ProposeForm({ prefill, onClearPrefill }: { prefill?: ProposePrefill | null; onClearPrefill?: () => void }) {
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  // Se apaga al enviar, para que el aviso de "Viene de…" desaparezca sin
  // desmontar el formulario (y sin perder el mensaje de éxito).
  const [prefillActive, setPrefillActive] = useState(!!prefill);
  const [productName, setProductName] = useState(prefill?.productName ?? "");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState(prefill?.imageUrl ?? "");
  const [uploading, setUploading] = useState(false);
  const [platform, setPlatform] = useState<"DROPI" | "ROCKET" | "BOTH">("DROPI");
  const [competitorId, setCompetitorId] = useState(prefill?.competitorId ?? "");
  const [competitorPrice, setCompetitorPrice] = useState(prefill?.competitorPrice ?? "");
  const [competitorBodegaName, setCompetitorBodegaName] = useState("");
  const [competitorProductName, setCompetitorProductName] = useState(prefill?.productName ?? "");
  const [noCompetitorData, setNoCompetitorData] = useState(false);
  const [discoverySourceNote, setDiscoverySourceNote] = useState("");
  const [insurance, setInsurance] = useState("6");
  const [fulfillment, setFulfillment] = useState("0.75");
  const [margin, setMargin] = useState("20");
  const [primarySupplierId, setPrimarySupplierId] = useState(prefill?.supplierId ?? "");
  const [primaryCost, setPrimaryCost] = useState("");
  const [primaryUnits, setPrimaryUnits] = useState("100");
  const [primaryFreight, setPrimaryFreight] = useState("");
  const [primaryNoFreight, setPrimaryNoFreight] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Guardado automático: si sale a revisar otra pantalla antes de terminar
  // de proponer este producto, al volver encuentra todo lo llenado tal
  // como lo había dejado (nombre, imagen, competencia, calculadora, etc.).
  const { clearDraft: clearProposeDraft } = useFormDraft<ProposeDraftData>(
    // Un borrador aparte por cada producto traído de Ganadores no
    // encontrados, para no pisar el borrador de una propuesta nueva.
    prefill ? `marketProductPropose:unfound:${prefill.unfoundId}` : "marketProductPropose:new",
    {
      productName, description, imageUrl, platform,
      competitorId, competitorPrice, competitorBodegaName, competitorProductName,
      noCompetitorData, discoverySourceNote,
      insurance, fulfillment, margin,
      primarySupplierId, primaryCost, primaryUnits, primaryFreight, primaryNoFreight,
    },
    (d) => {
      setProductName(d.productName);
      setDescription(d.description);
      setImageUrl(d.imageUrl);
      setPlatform(d.platform);
      setCompetitorId(d.competitorId);
      setCompetitorPrice(d.competitorPrice);
      setCompetitorBodegaName(d.competitorBodegaName);
      setCompetitorProductName(d.competitorProductName);
      setNoCompetitorData(d.noCompetitorData);
      setDiscoverySourceNote(d.discoverySourceNote);
      setInsurance(d.insurance);
      setFulfillment(d.fulfillment);
      setMargin(d.margin);
      setPrimarySupplierId(d.primarySupplierId);
      setPrimaryCost(d.primaryCost);
      setPrimaryUnits(d.primaryUnits);
      setPrimaryFreight(d.primaryFreight);
      setPrimaryNoFreight(d.primaryNoFreight);
    },
    isProposeDraftEmpty,
    "Producto sin terminar de proponer",
    "/area/workspace?tab=analisis-mercado"
  );

  useEffect(() => {
    fetch("/api/purchase-suppliers").then((r) => (r.ok ? r.json() : [])).then(setSuppliers).catch(() => setSuppliers([]));
  }, []);

  const showsCompetitor = platform !== "ROCKET" && !noCompetitorData;
  const preview = computePreviewPrice(Number(primaryCost), Number(primaryUnits), Number(primaryFreight), Number(insurance), Number(fulfillment), Number(margin));
  const competitorComparison = showsCompetitor && competitorPrice
    ? computeCompetitorComparison(Number(primaryCost), Number(primaryUnits), Number(primaryFreight), Number(insurance), Number(competitorPrice))
    : null;

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

  // Pedido del usuario 2026-10-05: antes de enviar se revisa la ortografía
  // del nombre comercial (una vez por nombre). Solo sugiere, nunca frena.
  const [spellCheckedName, setSpellCheckedName] = useState<string | null>(null);
  const [spellingFix, setSpellingFix] = useState<string | null>(null);
  const productNameState = productName;

  async function submit(nameOverride?: string) {
    setErr(""); setOk("");
    const productName = (nameOverride ?? productNameState).trim();
    if (!productName || !imageUrl || !primarySupplierId || !primaryCost || !primaryUnits) {
      setErr("Completa nombre, imagen, y el proveedor obligatorio con su costo y unidades.");
      return;
    }
    if (!primaryNoFreight && !primaryFreight.trim()) {
      setErr("Falta el flete del proveedor. Ponlo, o marca \"Este proveedor no cobra flete\" si de verdad no aplica.");
      return;
    }
    setBusy(true);
    if (spellCheckedName !== productName) {
      const check = await fetch("/api/market-products/check-spelling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: productName }),
      }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      setSpellCheckedName(productName);
      if (check?.spellingFix) {
        setBusy(false);
        setSpellingFix(check.spellingFix);
        return;
      }
    }
    setSpellingFix(null);
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
        primarySupplierPrice: { supplierId: primarySupplierId, batchCost: Number(primaryCost), batchUnits: Number(primaryUnits), freightCost: primaryNoFreight ? 0 : Number(primaryFreight) },
        unfoundWinningProductId: prefillActive ? prefill?.unfoundId : undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? "No se pudo enviar."); return; }
    setOk("Propuesta enviada a Bryan para aprobación.");
    setProductName(""); setDescription(""); setImageUrl(""); setCompetitorId(""); setCompetitorPrice(""); setCompetitorBodegaName(""); setCompetitorProductName("");
    setNoCompetitorData(false); setDiscoverySourceNote("");
    setPrimarySupplierId(""); setPrimaryCost(""); setPrimaryUnits("100"); setPrimaryFreight(""); setPrimaryNoFreight(false);
    clearProposeDraft();
    if (prefillActive) { setPrefillActive(false); setOk("Propuesta enviada a Bryan para aprobación. En Ganadores no encontrados ya quedó marcado como propuesto."); }
  }

  return (
    <div className="max-w-xl">
      <TabGuide storageKey="analisismercado-proponer">
        Llena los datos del producto y de tu proveedor — la calculadora de abajo te va sacando el precio de Dropi solo. Cuando pongas el precio de la competencia, te va a salir automáticamente: (1) cuánto más barato o más caro sale tu precio comparado con el de ella, y (2) qué margen te quedaría si vendieras al mismo precio que la competencia (en verde si alcanza tu margen mínimo, en rojo si no). Así ves de una vez si el producto conviene, sin sacar cuentas a mano.
      </TabGuide>
      {prefill && prefillActive && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-teal bg-teal/5 px-3 py-2 text-[12px] text-ink">
          <span>Viene de <b>Ganadores no encontrados</b> — completa el costo del proveedor y envíalo.</span>
          <button type="button" className="text-steel underline decoration-dotted cursor-pointer shrink-0" onClick={() => { clearProposeDraft(); onClearPrefill?.(); }}>
            Empezar de cero
          </button>
        </div>
      )}
      <div className="mb-3">
        <label className="text-[12px] font-semibold text-steel">Nombre comercial</label>
        <input className="w-full rounded border border-rule px-2.5 py-1.5 text-[13px] mt-1" value={productName} onChange={(e) => setProductName(e.target.value)} />
      </div>
      <div className="mb-3">
        <label className="text-[12px] font-semibold text-steel">Imagen referencial</label>
        {imageUrl ? (
          <div className="mt-1.5 flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img loading="lazy" decoding="async" src={imageUrl} alt="Imagen referencial" className="w-16 h-16 object-cover rounded border border-rule cursor-pointer" />
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
          {competitorPrice && preview !== null && (
            <div className="mt-2.5 pt-2.5 border-t border-rule text-[12px] space-y-1">
              <div className="text-ink">
                Tu precio de Dropi: <b>{money(preview)}</b> vs competencia: <b>{money(Number(competitorPrice))}</b>
                {" — "}
                {preview <= Number(competitorPrice) ? (
                  <span className="text-teal font-semibold">{money(Number(competitorPrice) - preview)} más barato</span>
                ) : (
                  <span className="text-red font-semibold">{money(preview - Number(competitorPrice))} más caro</span>
                )}
              </div>
              {competitorComparison && (
                <div className="text-steel">
                  Margen si vendieras al precio de la competencia: entre{" "}
                  <b className={competitorComparison.marginMin >= Number(margin) ? "text-teal" : "text-red"}>{competitorComparison.marginMin.toFixed(1)}%</b>
                  {" y "}
                  <b className={competitorComparison.marginMax >= Number(margin) ? "text-teal" : "text-red"}>{competitorComparison.marginMax.toFixed(1)}%</b>
                  {" "}(tu margen mínimo pedido: {margin}%)
                </div>
              )}
            </div>
          )}
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
        <div className="text-[12px] font-semibold text-steel mb-2">Proveedor</div>
        <SupplierSelect suppliers={suppliers} value={primarySupplierId} onChange={setPrimarySupplierId} />
        <div className="grid grid-cols-3 gap-2">
          <input className="rounded border border-rule px-2.5 py-1.5 text-[13px]" placeholder="Costo unitario (USD)" type="number" step="0.01" value={primaryCost} onChange={(e) => setPrimaryCost(e.target.value)} />
          <input className="rounded border border-rule px-2.5 py-1.5 text-[13px]" placeholder="Unidades del lote" type="number" value={primaryUnits} onChange={(e) => setPrimaryUnits(e.target.value)} />
          <input
            className="rounded border border-rule px-2.5 py-1.5 text-[13px] disabled:bg-cloud disabled:text-steel"
            placeholder="Flete del lote (USD)"
            type="number"
            step="0.01"
            value={primaryNoFreight ? "" : primaryFreight}
            disabled={primaryNoFreight}
            onChange={(e) => setPrimaryFreight(e.target.value)}
          />
        </div>
        <label className="mt-2 flex items-center gap-2 text-[12px] text-steel cursor-pointer">
          <input type="checkbox" checked={primaryNoFreight} onChange={(e) => setPrimaryNoFreight(e.target.checked)} />
          Este proveedor no cobra flete
        </label>
      </div>

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

      {spellingFix && spellCheckedName === productNameState.trim() && (
        <div className="bg-gold/10 border border-gold/30 rounded-md p-3 mb-3 text-[12.5px] text-ink">
          <div className="mb-1.5">Parece que el nombre tiene una falta de ortografía. ¿Quisiste decir <b>{spellingFix}</b>?</div>
          <div className="flex gap-2.5">
            <button
              type="button"
              disabled={busy}
              className="rounded border border-teal bg-teal px-2.5 py-1 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60"
              onClick={() => { const fix = spellingFix; setProductName(fix); setSpellCheckedName(fix); submit(fix); }}
            >
              Sí, corregirlo y enviar
            </button>
            <button type="button" disabled={busy} className="text-steel text-[12px] cursor-pointer" onClick={() => submit()}>
              No, está bien así — enviar
            </button>
          </div>
        </div>
      )}
      {err && <div className="text-red text-[12.5px] mb-2">{err}</div>}
      {ok && <div className="text-teal text-[12.5px] mb-2">{ok}</div>}
      <button type="button" disabled={busy} className="rounded border border-blue bg-blue px-4 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => submit()}>
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
  const [rocketOnly, setRocketOnly] = useState<Record<string, boolean>>({});
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
      body: JSON.stringify({ decision: "APPROVED", bodega: bodega[id], isPublic: !rocketOnly[id] && isPublic[id] !== false, rocketOnly: !!rocketOnly[id] }),
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
            <img loading="lazy" decoding="async" src={p.referenceImageUrl} alt="" className="w-16 h-16 rounded object-cover shrink-0" />
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
                <label className={`flex items-center gap-1 text-[12px] text-steel ${rocketOnly[p.id] ? "opacity-50" : ""}`}>
                  <input type="checkbox" disabled={!!rocketOnly[p.id]} checked={!rocketOnly[p.id] && isPublic[p.id] !== false} onChange={(e) => setIsPublic((s) => ({ ...s, [p.id]: e.target.checked }))} /> {!rocketOnly[p.id] && isPublic[p.id] !== false ? "Público" : "Privado"}
                </label>
                {/* Aprobado por Bryan 2026-10-10: excepción — privado en Dropi y Yair lo sube a Rocket. */}
                <label className="flex items-center gap-1 text-[12px] text-steel" title="El ID de Dropi se crea en privado y Yair lo sube a Rocket como Provedix">
                  <input type="checkbox" checked={!!rocketOnly[p.id]} onChange={(e) => setRocketOnly((s) => ({ ...s, [p.id]: e.target.checked }))} /> Solo Rocket por ahora
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
// Confirmado 2026-09-28, pedido del usuario — ver catalogMissingDropiId.ts.
// Productos creados en Compras sin ID antes de que se exigiera: Heidy les
// pone el ID acá, con la misma doble confirmación que PublishQueue. Si no
// hay ninguno, no se muestra nada.
type MissingIdItem = { id: string; name: string; photos: string[]; bodega: string | null; createdBy: { name: string } | null; dropiPrice: number | null };
function CatalogMissingIdQueue() {
  const [rows, setRows] = useState<MissingIdItem[]>([]);
  const [dropiId, setDropiId] = useState<Record<string, string>>({});
  const [errId, setErrId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/market-products/catalog-missing-id").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }
  useEffect(load, []);

  async function save(id: string) {
    setErr(""); setBusy(id);
    const res = await fetch("/api/market-products/catalog-missing-id", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogItemId: id, dropiProductId: dropiId[id]?.trim() ?? "" }),
    });
    setBusy(null);
    setConfirmingId(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? "No se pudo guardar."); setErrId(id); return; }
    load();
  }

  if (rows.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="text-[13.5px] font-bold mb-1">Productos de Compras sin ID de Dropi</div>
      <div className="text-[12px] text-steel mb-3">Se crearon en Compras antes de que se pidiera el ID. Escribe el ID que tiene en Dropi (si todavía no está publicado, publícalo primero).</div>
      <div className="flex flex-col gap-3">
        {rows.map((p) => (
          <div key={p.id} className="bg-surface border border-rule rounded-md p-3.5">
            <div className="flex items-start gap-3 mb-2">
              {p.photos[0] && <img loading="lazy" decoding="async" src={p.photos[0]} alt="" className="w-16 h-16 rounded object-cover shrink-0" />}
              <div className="flex-1">
                <div className="font-semibold text-[13.5px]">{p.name}</div>
                <div className="text-[12px] text-steel">Bodega: {BODEGA_LABELS[p.bodega ?? ""] ?? "—"} · Creado por {p.createdBy?.name ?? "—"}</div>
              </div>
            </div>
            {p.dropiPrice != null && <CopyDropiPrice price={p.dropiPrice} />}
            {err && errId === p.id && <div className="text-red text-[12.5px] mb-2">{err}</div>}
            {confirmingId === p.id ? (
              <div className="bg-inset rounded-md p-3">
                <div className="text-[13px] font-bold mb-1.5">¿Seguro?</div>
                <div className="text-[12px] text-steel mb-2.5">
                  Vas a guardar el ID <b className="text-ink">{dropiId[p.id]}</b> para <b className="text-ink">{p.name}</b> — verifica que sea esta foto.
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" disabled={busy === p.id} className="rounded border border-teal bg-teal px-3.5 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={() => save(p.id)}>
                    {p.dropiPrice != null ? `Sí, este ID es de este producto y puse $${p.dropiPrice.toFixed(2)} o más en Dropi` : "Sí, este ID es de este producto"}
                  </button>
                  <button type="button" className="text-steel text-[12px] cursor-pointer" onClick={() => setConfirmingId(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <input className="flex-1 min-w-0 rounded border border-rule px-2.5 py-1.5 text-[13px]" placeholder="ID que tiene en Dropi" value={dropiId[p.id] ?? ""} onChange={(e) => setDropiId((s) => ({ ...s, [p.id]: e.target.value }))} />
                <button
                  type="button"
                  className="rounded border border-teal bg-teal px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
                  disabled={!dropiId[p.id]?.trim()}
                  onClick={() => { setErr(""); setErrId(null); setConfirmingId(p.id); }}
                >
                  Guardar ID
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PublishQueue() {
  const [rows, setRows] = useState<Proposal[] | null>(null);
  const [dropiId, setDropiId] = useState<Record<string, string>>({});
  const [errId, setErrId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  // Confirmado 2026-09-18, pedido explícito del usuario: doble confirmación
  // antes de guardar el ID — Heidy puede tener varios productos pendientes a
  // la vez, esto evita que le pegue el ID equivocado a un producto por
  // apuro. Primero escribe el ID, después tiene que confirmar viendo la
  // foto+nombre del producto exacto antes de que se guarde de verdad.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

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
    setConfirmingId(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? "No se pudo publicar."); setErrId(id); return; }
    load();
  }

  if (rows === null) return <div className="text-steel text-[13px]">Cargando…</div>;
  if (rows.length === 0) return <div className="text-steel text-[13.5px]">No hay productos aprobados esperando publicarse.</div>;

  return (
    <div className="flex flex-col gap-3">
      {err && !errId && <div className="text-red text-[12.5px]">{err}</div>}
      {rows.map((p) => (
        <div key={p.id} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="flex items-start gap-3 mb-2">
            <img loading="lazy" decoding="async" src={p.referenceImageUrl} alt="" className="w-16 h-16 rounded object-cover shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-[13.5px]">{p.code} — {p.productName}</div>
              {/* Pedido del usuario 2026-09-30 (Bryan, casco SC-124). */}
              {p.purchasesInTransit && p.purchasesInTransit.length > 0 && (
                <div className="inline-block my-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase bg-red/10 border border-red/40 text-red">
                  Compra en camino ({p.purchasesInTransit.join(", ")}) — publícalo primero
                </div>
              )}
              {p.rocketOnly && !p.isPublic && (
                <div className="inline-block my-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase bg-yellow/10 border border-yellow/40 text-yellow">
                  Solo Rocket por ahora — créalo en privado
                </div>
              )}
              <div className="text-[12px] text-steel">Bodega: {BODEGA_LABELS[p.bodega ?? ""] ?? "—"} · {p.isPublic ? "Público" : "Privado"} · Cantidad por defecto: 100</div>
              <div className="text-[13px] font-bold text-ink mt-1">Precio de Dropi: {money(p.calculatedSalePrice)}</div>
            </div>
          </div>
          <PublishPriceGuide p={p} />
          {p.calculatedSalePrice != null && <CopyDropiPrice price={p.calculatedSalePrice} label="Precio Dropi mínimo" />}
          {err && errId === p.id && <div className="text-red text-[12.5px] mb-2">{err}</div>}
          {confirmingId === p.id ? (
            <div className="bg-inset rounded-md p-3">
              <div className="text-[13px] font-bold mb-1.5">¿Seguro?</div>
              <div className="flex items-center gap-2.5 mb-2.5">
                <img loading="lazy" decoding="async" src={p.referenceImageUrl} alt="" className="w-12 h-12 rounded object-cover border border-rule shrink-0" />
                <div className="text-[12px] text-steel">
                  Vas a guardar el ID <b className="text-ink">{dropiId[p.id]}</b> para <b className="text-ink">{p.productName}</b> — verifica que sea esta foto y no la de otro producto que estés subiendo al mismo tiempo.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" disabled={busy === p.id} className="rounded border border-teal bg-teal px-3.5 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={() => publish(p.id)}>
                  Sí, este ID es de este producto y puse {money(p.calculatedSalePrice)} o más en Dropi
                </button>
                <button type="button" className="text-steel text-[12px] cursor-pointer" onClick={() => setConfirmingId(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <input className="flex-1 min-w-0 rounded border border-rule px-2.5 py-1.5 text-[13px]" placeholder="ID que te dio Dropi" value={dropiId[p.id] ?? ""} onChange={(e) => setDropiId((s) => ({ ...s, [p.id]: e.target.value }))} />
              <button
                type="button"
                className="rounded border border-teal bg-teal px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
                disabled={!dropiId[p.id]?.trim()}
                onClick={() => { setErr(""); setErrId(null); setConfirmingId(p.id); }}
              >
                Confirmar publicado
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Confirmado 2026-09-22, pedido explícito del usuario: Heidy veía solo el
// precio de Dropi sin saber de dónde salía ni contra qué competía. El
// objetivo al publicar es quedar MÁS BARATO que la competencia pero con el
// mayor margen posible — nunca más caro. Por eso siempre ve el precio de la
// competencia al lado, el rango en el que conviene publicar, y (con un
// click) el desglose paso a paso de nuestro precio.
function PublishPriceGuide({ p }: { p: Proposal }) {
  const [open, setOpen] = useState(false);
  const sp = p.supplierPrices.find((x) => x.isPrimary) ?? p.supplierPrices[0] ?? null;
  const ourPrice = p.calculatedSalePrice;
  const comp = p.competitorPrice && p.competitorPrice > 0 ? p.competitorPrice : null;

  let bodega: number | null = null;
  let freightPerUnit = 0;
  let totalCost: number | null = null;
  if (sp && sp.batchUnits > 0) {
    freightPerUnit = (sp.freightCost ?? 0) / sp.batchUnits;
    bodega = sp.batchCost + freightPerUnit;
    totalCost = bodega * (1 + p.insuranceRatePercent / 100) + p.fulfillmentCost;
  }
  // Un centavo menos que la competencia: el precio más alto que igual sale
  // más barato que ella.
  const bestPrice = comp !== null ? Math.round((comp - 0.01) * 100) / 100 : null;
  const bestMargin = bestPrice !== null && totalCost !== null && bestPrice > 0 ? (1 - totalCost / bestPrice) * 100 : null;
  const compRef = comp !== null && (p.competitorBodegaName || p.competitorId)
    ? ` (${[p.competitorBodegaName, p.competitorId ? `ID ${p.competitorId}` : null].filter(Boolean).join(" · ")})`
    : "";

  return (
    <div className="mb-2.5 bg-cloud border border-rule rounded-md p-2.5 text-[12px]">
      {comp === null ? (
        <div className="text-steel">
          {p.noCompetitorData
            ? `Jariel no registró precio de la competencia para este producto (${p.discoverySourceNote || "recomendado por proveedor"}).`
            : "No se registró precio de la competencia para este producto."}{" "}
          Si lo encuentras en Dropi, ponlo más barato que la competencia pero nunca por debajo de <b className="text-ink">{money(ourPrice)}</b>.
        </div>
      ) : (
        <div className="space-y-1">
          <div className="text-ink">
            Precio de la competencia: <b>{money(comp)}</b><span className="text-steel">{compRef}</span>
          </div>
          {ourPrice < comp ? (
            <div className="text-steel">
              Pon en Dropi un precio entre <b className="text-ink">{money(ourPrice)}</b> (lo mínimo, deja el {p.marginPercent}% de margen) y{" "}
              <b className="text-teal">{money(bestPrice!)}</b> (un centavo menos que la competencia
              {bestMargin !== null ? <>, deja el <b className="text-teal">{bestMargin.toFixed(1)}%</b> de margen</> : null}).
              Mientras más cerca de {money(comp)}, más ganamos — pero nunca igual o más caro que la competencia.
            </div>
          ) : (
            <div className="text-red font-semibold">
              Ojo: nuestro precio mínimo ({money(ourPrice)}) no queda más barato que la competencia ({money(comp)}). Para quedar más baratos habría que bajar del margen mínimo — avísale a Bryan antes de publicarlo.
            </div>
          )}
        </div>
      )}

      <button type="button" className="mt-1.5 text-[11.5px] font-semibold text-teal cursor-pointer" onClick={() => setOpen((v) => !v)}>
        {open ? "Ocultar cálculo ▴" : "Ver cómo se calculó el precio de Dropi ▾"}
      </button>
      {open && (
        sp && bodega !== null && totalCost !== null ? (
          <table className="mt-1.5 w-full text-[12px]">
            <tbody>
              <tr><td className="text-steel py-0.5">Costo del proveedor por unidad</td><td className="text-right text-ink">{money(sp.batchCost)}</td></tr>
              <tr>
                <td className="text-steel py-0.5">+ Flete repartido {sp.freightCost ? `(${money(sp.freightCost)} ÷ ${sp.batchUnits} unidades)` : "(sin flete)"}</td>
                <td className="text-right text-ink">{money(freightPerUnit)}</td>
              </tr>
              <tr className="border-t border-rule"><td className="text-steel py-0.5">= Costo puesto en bodega</td><td className="text-right text-ink">{money(bodega)}</td></tr>
              <tr><td className="text-steel py-0.5">+ Seguro ({p.insuranceRatePercent}%)</td><td className="text-right text-ink">{money((bodega * p.insuranceRatePercent) / 100)}</td></tr>
              <tr><td className="text-steel py-0.5">+ Fulfillment</td><td className="text-right text-ink">{money(p.fulfillmentCost)}</td></tr>
              <tr className="border-t border-rule"><td className="text-steel py-0.5">= Lo que nos cuesta cada unidad</td><td className="text-right font-semibold text-ink">{money(totalCost)}</td></tr>
              <tr>
                <td className="text-steel py-0.5">Con {p.marginPercent}% de margen ({money(totalCost)} ÷ {((100 - p.marginPercent) / 100).toFixed(2)})</td>
                <td className="text-right font-bold text-ink">{money(ourPrice)}</td>
              </tr>
              <tr><td className="text-steel py-0.5">Ganancia por unidad a {money(ourPrice)}</td><td className="text-right text-teal font-semibold">{money(ourPrice - totalCost)}</td></tr>
              {comp !== null && bestPrice !== null && ourPrice < comp && (
                <tr><td className="text-steel py-0.5">Ganancia por unidad a {money(bestPrice)}</td><td className="text-right text-teal font-semibold">{money(bestPrice - totalCost)}</td></tr>
              )}
            </tbody>
          </table>
        ) : (
          <div className="mt-1.5 text-steel">No hay datos del proveedor guardados para mostrar el cálculo.</div>
        )
      )}
    </div>
  );
}

// Confirmado 2026-09-23, pedido de Heidy: al confirmar el ID de Dropi el
// producto salía de "Publicar en Dropi" y no quedaba dónde volver a verlo.
// Acá queda su historial, con buscador por nombre/código/ID de Dropi.
function PublishedHistoryView() {
  const [rows, setRows] = useState<Proposal[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/market-products?view=published-history").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }, []);

  if (rows === null) return <div className="text-steel text-[13px]">Cargando…</div>;
  if (rows.length === 0) return <div className="text-steel text-[13.5px]">Todavía no publicaste ningún producto.</div>;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter((p) => [p.productName, p.code, p.dropiProductId ?? ""].some((s) => s.toLowerCase().includes(q)))
    : rows;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <input
          className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[13px]"
          placeholder="Buscar por nombre, código o ID de Dropi…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="text-[12px] text-steel shrink-0">{filtered.length} de {rows.length}</span>
      </div>
      {filtered.length === 0 && <div className="text-steel text-[13px]">Sin resultados.</div>}
      {filtered.map((p) => {
        const image = p.catalogItem?.photos?.[0] || p.referenceImageUrl;
        return (
          <div key={p.id} className="bg-surface border border-rule rounded-md p-3.5 flex items-start gap-3.5">
            {image && <img loading="lazy" decoding="async" src={image} alt={p.productName} className="w-16 h-16 rounded object-cover border border-rule shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[13.5px]">{p.code} — {p.productName}</div>
              <div className="text-[12.5px] text-ink mt-0.5">ID de Dropi: <b>{p.dropiProductId ?? "—"}</b> · Precio de Dropi: <b>{money(p.calculatedSalePrice)}</b></div>
              <div className="text-[12px] text-steel mt-0.5">
                Bodega: {BODEGA_LABELS[p.bodega ?? ""] ?? "—"} · {p.isPublic ? "Público" : "Privado"}
              </div>
              <div className="text-[12px] text-steel mt-0.5">
                Publicado {p.publishedBy?.name ? `por ${p.publishedBy.name} ` : ""}— {p.publishedAt ? formatDateTime(p.publishedAt) : "—"}
              </div>
              <div className={`text-[12px] mt-0.5 font-semibold ${p.brandedAt ? "text-teal" : "text-steel"}`}>
                {p.brandedAt ? `Brandeado por ${p.brandedBy?.name ?? "—"} — ${formatDateTime(p.brandedAt)}` : "Esperando brandeo de Robert"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Paso 4 (Brandear) ya no vive acá: desde 2026-09-23 es la pestaña propia
// "Nuevos IDs por brandear" (NewIdBrandingPanel), pedido de Robert.

// ---------------- Paso 5: Trazabilidad + decisión de compra (Bryan) ----------------

type ConsultaRow = {
  id: string;
  name: string;
  justCode: string | null;
  photos: string[];
  // Confirmado 2026-09-15, pedido explícito del usuario: un combo (varios
  // productos empacados y enviados como uno solo) también aparece acá con
  // su propio precio de referencia — se distingue con una etiqueta, ya que
  // no es un producto del catálogo con foto propia.
  isCombo: boolean;
  costSource?: "proposal" | "kardex" | null;
  benistockPrice?: number;
  b2bPriceDefault?: number;
  b2cPrice1Unit?: number;
  b2cPrice2to11?: number;
};

// Confirmado 2026-09-14: pantalla de solo consulta — buscar un producto y
// ver a qué precio venderlo, sin ningún dato de costo ni declarar nada.
// Mismo patrón de búsqueda por nombre/código que ExpirationLotsPanel.tsx.
function PricingConsultaTable() {
  const [rows, setRows] = useState<ConsultaRow[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/market-products?view=consulta").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }, []);

  if (rows === null) return <div className="text-steel text-[13px]">Cargando…</div>;

  const q = query.trim().toLowerCase();
  const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q) || (r.justCode ?? "").toLowerCase().includes(q)) : rows;

  return (
    <div>
      <TabGuide storageKey="analisismercado-consulta">
        Busca un producto o combo para ver a qué precio venderlo — Benistock es el costo real sin ganancia (solo de referencia), B2B es el precio al por mayor, y B2C (1 unidad / 2 a 11 unidades) es el precio al detalle. No declara ninguna venta, solo consulta.
      </TabGuide>
      <input
        className="w-full max-w-sm rounded border border-rule px-2.5 py-1.5 text-[13px] mb-3"
        placeholder="Buscar producto o código…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {filtered.length === 0 ? (
        <div className="text-[12.5px] text-steel">
          {rows.length === 0 ? "Todavía no hay ningún producto con precio calculado." : "Sin resultados."}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {filtered.map((r) => (
            <div key={r.id} className="flex items-center gap-2.5 bg-surface border border-rule rounded-md p-2.5">
              {r.photos[0] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img loading="lazy" decoding="async" src={r.photos[0]} alt={r.name} className="w-10 h-10 object-cover rounded border border-rule shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold truncate flex items-center gap-1.5">
                  {r.isCombo && (
                    <span className="text-[9px] font-bold uppercase tracking-wide bg-blue/15 text-blue border border-blue/40 rounded-full px-1.5 py-0.5 shrink-0">Combo</span>
                  )}
                  <ExpandableName text={r.name} />
                </div>
                {r.justCode && <div className="text-[10.5px] font-mono text-steel">{r.justCode}</div>}
              </div>
              <div className="text-right shrink-0">
                {r.benistockPrice != null && (
                  <div className="text-[11.5px] text-steel">
                    <span className="font-bold text-ink">{money(r.benistockPrice)}</span> Benistock (costo, sin ganancia)
                  </div>
                )}
                {r.b2bPriceDefault != null && (
                  <div className="text-[13px] font-bold text-teal">
                    {money(r.b2bPriceDefault)} <span className="text-[10px] font-normal text-steel">B2B · 20%</span>
                  </div>
                )}
                {r.b2cPrice1Unit != null && (
                  <div className="text-[11.5px] text-ink">
                    1 un: <span className="font-bold">{money(r.b2cPrice1Unit)}</span>
                  </div>
                )}
                {r.b2cPrice2to11 != null && (
                  <div className="text-[11.5px] text-ink">
                    2-11 un: <span className="font-bold">{money(r.b2cPrice2to11)}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PROPOSAL_STATUS_LABEL: Record<Proposal["status"], { text: string; color: string }> = {
  PENDING_APPROVAL: { text: "Esperando aprobación de Bryan", color: "text-gold" },
  REJECTED: { text: "Rechazado", color: "text-red" },
  APPROVED: { text: "Aprobado", color: "text-teal" },
};

// Confirmado 2026-09-10, pedido de Jariel: seguimiento de sus propios
// productos propuestos — reusa GET ?view=mine (ya existía en la API, sin
// pantalla que lo consumiera) y el mismo estilo de línea de tiempo que
// TraceabilityView, adaptado para mostrar también lo pendiente y lo
// rechazado, no solo lo ya aprobado.
function MyProposalsView() {
  const [rows, setRows] = useState<(Proposal & { b2bPriceDefault?: number | null })[] | null>(null);

  useEffect(() => {
    fetch("/api/market-products?view=mine").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }, []);

  if (rows === null) return <div className="text-steel text-[13px]">Cargando…</div>;
  if (rows.length === 0) return <div className="text-steel text-[13.5px]">Todavía no propusiste ningún producto.</div>;

  return (
    <div className="flex flex-col gap-3">
      {rows.map((p) => {
        const status = PROPOSAL_STATUS_LABEL[p.status];
        const image = p.catalogItem?.photos?.[0] || p.referenceImageUrl;
        return (
          <div key={p.id} className="bg-surface border border-rule rounded-md p-3.5 flex items-start gap-3.5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-semibold text-[13.5px]">{p.code} — {p.productName}</span>
                <span className={`text-[11px] font-semibold ${status.color}`}>{status.text}</span>
              </div>
              {/* Pedido de Jariel 2026-09-29: con qué proveedor lo propuso, a
                  cuánto se lo vende el proveedor y el precio B2B (20%). */}
              {p.supplierPrices.length > 0 && (
                <div className="text-[12.5px] mb-2 flex flex-col gap-0.5">
                  {[...p.supplierPrices].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).map((sp) => (
                    <div key={sp.id} className="text-steel">
                      Proveedor{p.supplierPrices.length > 1 ? (sp.isPrimary ? " 1°" : " 2°") : ""}: <span className="text-ink font-semibold">{sp.supplier.name}</span> · <span className="text-ink font-semibold">{money(sp.batchCost)}</span> c/u
                      {sp.freightCost ? <> + flete {money(sp.freightCost)}</> : null}
                    </div>
                  ))}
                  {p.b2bPriceDefault != null && (
                    <div className="text-steel">
                      Precio B2B: <span className="text-teal font-bold">{money(p.b2bPriceDefault)}</span> <span className="text-[11px]">(20%)</span>
                    </div>
                  )}
                </div>
              )}
              {/* Pedido de Jariel 2026-09-29: también el precio de Dropi y con
                  qué ID de la competencia se comparó (si lo anotó). */}
              {p.platform !== "ROCKET" && (
                <div className="text-[12.5px] mb-2 flex flex-col gap-0.5 text-steel">
                  <div>
                    Precio de Dropi: <span className="text-ink font-bold">{money(p.calculatedSalePrice)}</span> <span className="text-[11px]">({p.marginPercent}%)</span>
                    {p.dropiProductId && <> · ID de Dropi: <span className="text-ink font-semibold">{p.dropiProductId}</span></>}
                  </div>
                  {p.noCompetitorData ? (
                    <div>Competencia: sin datos ({p.discoverySourceNote || "recomendado por proveedor"})</div>
                  ) : p.competitorId || p.competitorPrice ? (
                    <div>
                      Comparado con ID competencia: <span className="text-ink font-semibold">{p.competitorId || "—"}</span>
                      {p.competitorPrice ? <> · <span className="text-ink font-semibold">{money(p.competitorPrice)}</span></> : null}
                      {p.competitorBodegaName ? <> ({p.competitorBodegaName})</> : null}
                    </div>
                  ) : null}
                </div>
              )}
              {p.status === "REJECTED" && p.rejectReason && (
                <div className="text-[12px] text-red mb-2">Motivo: {p.rejectReason}</div>
              )}
              {/* Pedido del usuario 2026-10-03: le sale en Inicio hasta "Enterado". */}
              {p.status === "REJECTED" && !p.rejectionSeenAt && (
                <button
                  type="button"
                  className="mb-2 rounded border border-rule px-3 py-1 text-[12px] font-semibold text-steel cursor-pointer"
                  onClick={async () => {
                    const res = await fetch(`/api/market-products/${p.id}/seen-rejection`, { method: "POST" }).catch(() => null);
                    if (res?.ok) setRows((rs) => rs?.map((x) => (x.id === p.id ? { ...x, rejectionSeenAt: new Date().toISOString() } : x)) ?? rs);
                  }}
                >
                  Enterado
                </button>
              )}
              {p.status === "APPROVED" && (
                <ol className="text-[12.5px] text-steel space-y-0.5">
                  <li>1. Propuesto — {formatDateTime(p.proposedAt)}</li>
                  <li>2. Aprobado por {p.reviewedBy?.name ?? "—"} — {p.reviewedAt ? formatDateTime(p.reviewedAt) : "—"}</li>
                  <li>3. Publicado por {p.publishedBy?.name ?? "—"} — {p.publishedAt ? formatDateTime(p.publishedAt) : "pendiente"}</li>
                  <li>4. Brandeado por {p.brandedBy?.name ?? "—"} — {p.brandedAt ? formatDateTime(p.brandedAt) : "pendiente"}</li>
                  {p.readyToBuyAt && <li>5. Listo para comprar con {p.chosenSupplier?.name} — {formatDateTime(p.readyToBuyAt)}</li>}
                </ol>
              )}
              {p.status === "PENDING_APPROVAL" && (
                <div className="text-[12px] text-steel">Propuesto — {formatDateTime(p.proposedAt)}</div>
              )}
            </div>
            {image && (
              <img loading="lazy" decoding="async"
                src={image}
                alt={p.productName}
                className="w-28 h-28 object-cover rounded border border-rule shrink-0 cursor-pointer"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Confirmado 2026-09-14, pedido explícito del usuario: antes, cuando Bryan
// marcaba un producto "listo para comprar", a Jariel solo le llegaba el
// aviso — no había ninguna pantalla para retomar desde ahí, tenía que
// acordarse solo y armar la solicitud de compra de cero en Control de
// Compras. Este tab consume la vista view=ready-to-buy (ya existía en la
// API, pero ninguna pantalla la usaba) y deja saltar directo a Control de
// Compras con el producto y el proveedor ya elegidos precargados — ver el
// nuevo efecto que lee presetCatalogItemId/presetSupplierId en
// PurchaseRequestForm.tsx. Se navega con <a href> (no router.push) a
// propósito: ?tab=/?ptab= en Control de Compras se leen en un efecto que
// solo corre al montar, así que hace falta una navegación real, no un
// cambio de ruta del lado del cliente.
function ReadyToBuyQueue() {
  const [rows, setRows] = useState<Proposal[] | null>(null);

  useEffect(() => {
    fetch("/api/market-products?view=ready-to-buy").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }, []);

  if (rows === null) return <div className="text-steel text-[13px]">Cargando…</div>;
  if (rows.length === 0) return <div className="text-steel text-[13.5px]">No hay productos listos para comprar todavía.</div>;

  function buyUrl(p: Proposal): string | null {
    if (!p.catalogItem || !p.chosenSupplier) return null;
    const params = new URLSearchParams({
      tab: "compras",
      ptab: "solicitar",
      presetCatalogItemId: p.catalogItem.id,
      presetSupplierId: p.chosenSupplier.id,
      marketProductProposalId: p.id,
    });
    return `/area/workspace?${params.toString()}`;
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((p) => {
        const url = buyUrl(p);
        return (
          <div key={p.id} className="bg-surface border border-rule rounded-md p-3.5">
            <div className="font-semibold text-[13.5px] mb-1.5">{p.code} — {p.productName}</div>
            <div className="text-[12.5px] text-steel mb-2.5">
              Proveedor elegido: <b className="text-ink">{p.chosenSupplier?.name ?? "—"}</b>
              {p.chosenSupplier?.paymentMode === "CREDITO" && (
                <span className="ml-1 font-semibold" style={{ color: "var(--color-gold)" }}>
                  (crédito)
                </span>
              )}
              {" · "}Listo desde {p.readyToBuyAt ? formatDateTime(p.readyToBuyAt) : "—"}
            </div>
            {url ? (
              <a href={url} className="inline-flex items-center gap-1.5 text-[12px] font-bold text-navy bg-teal border border-teal rounded px-3 py-1.5 cursor-pointer">
                Comprar en Control de Compras
              </a>
            ) : (
              <div className="text-[11.5px] text-red">Falta el producto o el proveedor elegido — avísale al admin.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TraceabilityView({ canDecidePurchase, canCancel, canRequestPublic }: { canDecidePurchase: boolean; canCancel: boolean; canRequestPublic: boolean }) {
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

  // Confirmado 2026-09-18, pedido explícito del usuario: liberación final —
  // recién acá el catálogo recibe su justCode real y cualquier compra ya
  // recibida mientras se esperaba el ID entra al Kardex. Doble confirmación
  // (window.confirm) porque no se puede deshacer.
  const [releasingId, setReleasingId] = useState<string | null>(null);
  async function releaseKardex(id: string, productName: string) {
    if (!confirm(`¿Confirmas que el ID de Dropi de "${productName}" es correcto? Se le va a poner ese ID al catálogo y se va a sumar al Kardex de INVESTOCK lo que ya haya llegado — no se puede deshacer.`)) return;
    setErr(""); setReleasingId(id);
    const res = await fetch(`/api/market-products/${id}/release-kardex`, { method: "POST" });
    setReleasingId(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? "No se pudo liberar."); return; }
    load();
  }

  // Pedido del usuario 2026-10-03 (AM-0018): cerrar una propuesta aprobada
  // que al final no se va a vender — ver api/market-products/[id]/cancel.
  async function cancelProposal(id: string, label: string) {
    const reason = prompt(`¿Por qué se cancela ${label}? Deja de estar aprobada y sale de publicar y de listo para comprar.`);
    if (!reason?.trim()) return;
    setErr(""); setBusy(id);
    const res = await fetch(`/api/market-products/${id}/cancel`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setBusy(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? "No se pudo cancelar."); return; }
    load();
  }

  // Aprobado por Bryan 2026-10-10: Bryan decide pasarlo a público en Dropi
  // y la asesora B2B lo ejecuta (le llega aviso + pendiente).
  async function requestPublic(id: string, productName: string) {
    if (!confirm(`¿Pasar "${productName}" a público en Dropi? La asesora B2B recibe el aviso para hacerlo.`)) return;
    setErr(""); setBusy(id);
    const res = await fetch(`/api/market-products/${id}/request-public`, { method: "POST" });
    setBusy(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? "No se pudo pedir."); return; }
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
          {p.rocketOnly && (
            <div className="bg-inset rounded-md p-2.5 mb-3 text-[12px] text-ink">
              <div className="font-semibold mb-0.5">Solo Rocket por ahora</div>
              <div className="text-steel">
                {p.rocketSku
                  ? <>En Rocket: ID <b className="text-ink">{p.rocketProductId}</b> · SKU <b className="text-ink">{p.rocketSku}</b> — {p.rocketSkuBy?.name ?? "—"}, {p.rocketSkuAt ? formatDateTime(p.rocketSkuAt) : ""}</>
                  : p.rocketSkuOverdue
                    ? <span className="text-red font-semibold">Atrasado: van más de 24 h sin subirse a Rocket.</span>
                    : "Esperando que se suba a Rocket (ID y SKU)."}
              </div>
              <div className="text-steel mt-0.5">
                Dropi: {p.madePublicAt
                  ? `público desde ${formatDateTime(p.madePublicAt)}`
                  : p.publicRequestedAt
                    ? "pediste pasarlo a público — falta que la asesora B2B lo cambie"
                    : "privado"}
              </div>
              {canRequestPublic && !p.isPublic && !p.publicRequestedAt && (
                <button type="button" disabled={busy === p.id} className="mt-2 rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => requestPublic(p.id, p.productName)}>
                  Pasar a público en Dropi
                </button>
              )}
            </div>
          )}
          <ol className="text-[12.5px] text-steel space-y-0.5 mb-3">
            <li>1. Propuesto por {p.proposedBy?.name ?? "—"} — {formatDateTime(p.proposedAt)}</li>
            <li>2. Aprobado por {p.reviewedBy?.name ?? "—"} — {p.reviewedAt ? formatDateTime(p.reviewedAt) : "—"}</li>
            <li>3. Publicado por {p.publishedBy?.name ?? "—"} — {p.publishedAt ? formatDateTime(p.publishedAt) : "pendiente"}</li>
            <li>4. Brandeado por {p.brandedBy?.name ?? "—"} — {p.brandedAt ? formatDateTime(p.brandedAt) : "pendiente"}</li>
          </ol>
          {p.traceability?.totalMinutes != null && (
            <div className="text-[12px] font-semibold text-ink mb-3">Tiempo total: {Math.floor(p.traceability.totalMinutes / 60)}h {p.traceability.totalMinutes % 60}min</div>
          )}
          {canDecidePurchase && p.catalogItem?.awaitingDropiId && p.publishedAt && !p.kardexReleasedAt && (
            <div className="bg-blue/10 border border-blue/30 rounded-md p-2.5 mb-3">
              <div className="text-[12px] text-ink mb-2">
                <B2BAdvisorName capital /> confirmó el ID de Dropi ({p.dropiProductId}). Cualquier compra de este producto que ya haya llegado a bodega está esperando esta liberación para sumarse a INVESTOCK.
                {!!p.kardexPendingUnits && (
                  <span className="block mt-1 font-semibold text-red">
                    Ya hay {p.kardexPendingUnits} un. en bodega que no aparecen en INVESTOCK hasta que lo liberes.
                  </span>
                )}
              </div>
              <button
                type="button"
                disabled={releasingId === p.id}
                className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60"
                onClick={() => releaseKardex(p.id, p.productName)}
              >
                {releasingId === p.id ? "Liberando…" : "Confirmar y liberar al Kardex"}
              </button>
            </div>
          )}
          {p.kardexReleasedAt && (
            <div className="text-[12px] text-teal font-semibold mb-2">
              Liberado al Kardex por {p.kardexReleasedBy?.name ?? "—"} — {formatDateTime(p.kardexReleasedAt)}
            </div>
          )}
          {!p.readyToBuyAt && p.boughtAt && (
            <div className="text-[12px] text-teal font-semibold">Ya comprado en Control de Compras — {formatDateTime(p.boughtAt)}</div>
          )}
          {canDecidePurchase && !p.readyToBuyAt && !p.boughtAt && p.catalogItem && (
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
          {/* Pedido del usuario 2026-10-03 (AM-0018): pendiente de Bryan en Inicio. */}
          {p.rejectedPurchase && (
            <div className="bg-red/10 border border-red/30 rounded-md p-2.5 mt-2 text-[12px] text-ink">
              <b>Su compra fue rechazada</b>{p.rejectedPurchase.code ? ` (${p.rejectedPurchase.code})` : ""}{p.rejectedPurchase.reason ? `: "${p.rejectedPurchase.reason}"` : ""}. La propuesta sigue aprobada.
              <span className="block text-steel mt-1">Si el producto ya no va, cancélala aquí. Si sí se va a comprar, pide que se reenvíe la compra corregida en Control de Compras.</span>
            </div>
          )}
          {canCancel && !p.publishedAt && !p.boughtAt && (
            <button type="button" disabled={busy === p.id} className="mt-2 rounded border border-red px-3 py-1.5 text-[12px] font-semibold text-red cursor-pointer disabled:opacity-60" onClick={() => cancelProposal(p.id, `${p.code} ${p.productName}`)}>
              Cancelar propuesta
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------- Solo Rocket por ahora (Yair) ----------------
// Aprobado por Bryan 2026-10-10: lo que Bryan aprobó como "Solo Rocket por
// ahora" — se sube a Rocket como Provedix con el mismo precio de la
// propuesta y se escriben el ID (lo que traen las guías, así los cortes de
// Rocket lo reconocen solos) y el SKU (referencia) que da Rocket. Ninguno
// reemplaza el ID madre del Kardex. Se pueden corregir si hubo un error.
function RocketUploadView() {
  const [rows, setRows] = useState<Proposal[] | null>(null);
  const [rocketId, setRocketId] = useState<Record<string, string>>({});
  const [sku, setSku] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ id: string; msg: string } | null>(null);

  function load() {
    fetch("/api/market-products?view=rocket").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }
  useEffect(load, []);

  async function save(id: string) {
    setErr(null); setBusy(id);
    const res = await fetch(`/api/market-products/${id}/rocket-sku`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rocketProductId: rocketId[id] ?? "", rocketSku: sku[id] ?? "" }),
    });
    setBusy(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr({ id, msg: d.error ?? "No se pudo guardar." }); return; }
    setEditing(null);
    load();
  }

  if (rows === null) return <div className="text-steel text-[13px]">Cargando…</div>;
  const pending = rows.filter((p) => !p.rocketSku);
  const done = rows.filter((p) => p.rocketSku);

  const card = (p: Proposal) => (
    <div key={p.id} className="bg-surface border border-rule rounded-md p-3.5">
      <div className="flex items-start gap-3 mb-2">
        <img loading="lazy" decoding="async" src={p.referenceImageUrl} alt="" className="w-16 h-16 rounded object-cover shrink-0" />
        <div className="flex-1">
          <div className="font-semibold text-[13.5px]">{p.code} — {p.productName}</div>
          <div className="text-[12px] text-steel">Marca: {BODEGA_LABELS[p.bodega ?? ""] ?? "—"} · Aprobado {p.reviewedAt ? formatDateTime(p.reviewedAt) : "—"}</div>
          <div className="text-[13px] font-bold text-ink mt-1">Precio: {money(p.calculatedSalePrice)}</div>
        </div>
      </div>
      {!p.rocketSku && <CopyDropiPrice price={p.calculatedSalePrice} label="Precio para Rocket" />}
      {err?.id === p.id && <div className="text-red text-[12.5px] mb-2">{err.msg}</div>}
      {p.rocketSku && editing !== p.id ? (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="text-teal font-semibold">ID {p.rocketProductId} · SKU {p.rocketSku}</span>
          <span className="text-steel">— {p.rocketSkuBy?.name ?? "—"}, {p.rocketSkuAt ? formatDateTime(p.rocketSkuAt) : ""}</span>
          <button type="button" className="text-steel text-[12px] underline cursor-pointer" onClick={() => { setRocketId((s) => ({ ...s, [p.id]: p.rocketProductId ?? "" })); setSku((s) => ({ ...s, [p.id]: p.rocketSku ?? "" })); setEditing(p.id); }}>
            Corregir
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <input className="w-28 rounded border border-rule px-2.5 py-1.5 text-[13px]" inputMode="numeric" placeholder="ID (ej. 5417)" value={rocketId[p.id] ?? ""} onChange={(e) => setRocketId((s) => ({ ...s, [p.id]: e.target.value }))} />
          <input className="flex-1 min-w-[180px] rounded border border-rule px-2.5 py-1.5 text-[13px]" placeholder="SKU (ej. 2075-PRO-TENSIOMETRO-DIGITAL)" value={sku[p.id] ?? ""} onChange={(e) => setSku((s) => ({ ...s, [p.id]: e.target.value }))} />
          <button type="button" disabled={busy === p.id || !rocketId[p.id]?.trim() || !sku[p.id]?.trim()} className="rounded border border-teal bg-teal px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => save(p.id)}>
            Guardar
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div className="text-[12px] text-steel mb-3">Súbelos a Rocket con la cuenta de Provedix, con el precio que sale aquí, y escribe el ID y el SKU que te da Rocket. El ID es el que sale en las guías; el SKU queda como referencia. Ninguno cambia el ID de Dropi del producto.</div>
      {pending.length === 0 ? (
        <div className="text-steel text-[13.5px] mb-5">No hay productos por subir a Rocket.</div>
      ) : (
        <div className="flex flex-col gap-3 mb-6">{pending.map(card)}</div>
      )}
      {done.length > 0 && (
        <>
          <div className="text-[13.5px] font-bold mb-2">Ya subidos</div>
          <div className="flex flex-col gap-3">{done.map(card)}</div>
        </>
      )}
    </div>
  );
}

// Aprobado por Bryan 2026-10-10: Bryan pidió pasar a público un producto que
// está privado en Dropi — la asesora B2B lo cambia en Dropi y lo confirma.
// Si no hay ninguno, no se muestra nada.
function MakePublicQueue() {
  const [rows, setRows] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/market-products?view=make-public").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }
  useEffect(load, []);

  async function confirmDone(id: string) {
    setErr(""); setBusy(id);
    const res = await fetch(`/api/market-products/${id}/made-public`, { method: "POST" });
    setBusy(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? "No se pudo confirmar."); return; }
    load();
  }

  if (rows.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="text-[13.5px] font-bold mb-1">Pasar a público en Dropi</div>
      <div className="text-[12px] text-steel mb-3">Bryan pidió que estos productos dejen de estar privados. Cámbialos a público en Dropi y confírmalo aquí.</div>
      {err && <div className="text-red text-[12.5px] mb-2">{err}</div>}
      <div className="flex flex-col gap-3">
        {rows.map((p) => (
          <div key={p.id} className="bg-surface border border-rule rounded-md p-3.5 flex items-center gap-3">
            <img loading="lazy" decoding="async" src={p.referenceImageUrl} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[13.5px]">{p.productName}</div>
              <div className="text-[12px] text-steel">ID Dropi {p.dropiProductId} · Pedido {p.publicRequestedAt ? formatDateTime(p.publicRequestedAt) : ""}</div>
            </div>
            <button type="button" disabled={busy === p.id} className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => confirmDone(p.id)}>
              Ya está público
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Ganadores no encontrados (Jariel) ----------------
// Confirmado 2026-09-22, pedido de Jariel: productos que ve ganando en la
// competencia pero que todavía ningún proveedor le ofrece. Antes los llevaba
// en una hoja de cálculo aparte (imagen, nombre, ID y precio de la
// competencia, proveedor opcional, semana). Acá quedan guardados para
// revisarlos después y, cuando un proveedor ya lo tenga, pasarlos a
// Proponer con todo precargado.
type UnfoundWinner = {
  id: string;
  productName: string;
  imageUrl: string;
  competitorId: string | null;
  competitorPrice: number | null;
  notes: string | null;
  weekYear: number;
  weekNumber: number;
  status: "PENDING" | "PROPOSED" | "DISCARDED";
  createdAt: string;
  supplier: { id: string; name: string } | null;
  createdBy: { name: string } | null;
  proposal: { id: string; code: string; status: Proposal["status"] } | null;
};

type UnfoundDraftData = { productName: string; imageUrl: string; competitorId: string; competitorPrice: string; supplierId: string; notes: string };

const UNFOUND_STATUS_LABEL: Record<UnfoundWinner["status"], { text: string; color: string }> = {
  PENDING: { text: "Buscando proveedor", color: "text-gold" },
  PROPOSED: { text: "Ya propuesto", color: "text-teal" },
  DISCARDED: { text: "Descartado", color: "text-steel" },
};

function UnfoundWinnersView({ onPropose }: { onPropose: (p: ProposePrefill) => void }) {
  const [rows, setRows] = useState<UnfoundWinner[] | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [productName, setProductName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [competitorId, setCompetitorId] = useState("");
  const [competitorPrice, setCompetitorPrice] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [filter, setFilter] = useState<"PENDING" | "PROPOSED" | "DISCARDED" | "ALL">("PENDING");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [search, setSearch] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Guardado automático solo para un registro nuevo — al editar uno ya
  // guardado, los datos vienen de la base, no de un borrador.
  const { clearDraft } = useFormDraft<UnfoundDraftData>(
    editingId ? null : "unfoundWinner:new",
    { productName, imageUrl, competitorId, competitorPrice, supplierId, notes },
    (d) => {
      setProductName(d.productName);
      setImageUrl(d.imageUrl);
      setCompetitorId(d.competitorId);
      setCompetitorPrice(d.competitorPrice);
      setSupplierId(d.supplierId);
      setNotes(d.notes);
    },
    (d) => !d.productName.trim() && !d.imageUrl && !d.competitorId.trim() && !d.competitorPrice.trim() && !d.supplierId && !d.notes.trim(),
    "Producto ganador sin terminar de registrar",
    "/area/workspace?tab=analisis-mercado"
  );

  function load() {
    fetch("/api/unfound-winning-products").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }

  useEffect(() => {
    load();
    fetch("/api/purchase-suppliers").then((r) => (r.ok ? r.json() : [])).then(setSuppliers).catch(() => setSuppliers([]));
  }, []);

  async function uploadImage(file: File) {
    setUploading(true);
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "market-product-reference");
    setUploading(false);
    if (!uploaded.ok) { setErr(uploaded.error); return; }
    setImageUrl(uploaded.url);
  }

  const { onPaste, onMouseEnter, onMouseLeave, onDragOver, onDragLeave, onDrop, isDragOver } = usePasteFile((file) => uploadImage(file));

  function resetForm() {
    setEditingId(null);
    setProductName(""); setImageUrl(""); setCompetitorId(""); setCompetitorPrice(""); setSupplierId(""); setNotes("");
  }

  function startEdit(r: UnfoundWinner) {
    setErr(""); setOk("");
    setEditingId(r.id);
    setProductName(r.productName);
    setImageUrl(r.imageUrl);
    setCompetitorId(r.competitorId ?? "");
    setCompetitorPrice(r.competitorPrice !== null ? String(r.competitorPrice) : "");
    setSupplierId(r.supplier?.id ?? "");
    setNotes(r.notes ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit() {
    setErr(""); setOk("");
    if (!productName.trim() || !imageUrl) { setErr("Falta el nombre y la imagen del producto."); return; }
    setBusy(true);
    const res = await fetch(editingId ? `/api/unfound-winning-products/${editingId}` : "/api/unfound-winning-products", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productName,
        imageUrl,
        competitorId: competitorId || undefined,
        competitorPrice: competitorPrice ? Number(competitorPrice) : undefined,
        supplierId: supplierId || undefined,
        notes: notes || undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? "No se pudo guardar."); return; }
    setOk(editingId ? "Cambios guardados." : "Producto registrado.");
    if (!editingId) clearDraft();
    resetForm();
    load();
  }

  async function setStatus(id: string, status: "PENDING" | "DISCARDED") {
    setRowBusy(id);
    const res = await fetch(`/api/unfound-winning-products/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    setRowBusy(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? "No se pudo cambiar."); return; }
    load();
  }

  async function remove(id: string) {
    setRowBusy(id);
    const res = await fetch(`/api/unfound-winning-products/${id}`, { method: "DELETE" });
    setRowBusy(null);
    setConfirmDeleteId(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? "No se pudo borrar."); return; }
    if (editingId === id) resetForm();
    load();
  }

  const q = search.trim().toLowerCase();
  const visible = (rows ?? []).filter((r) =>
    (filter === "ALL" || r.status === filter) &&
    (!supplierFilter || (supplierFilter === "none" ? !r.supplier : r.supplier?.id === supplierFilter)) &&
    (!q || r.productName.toLowerCase().includes(q) || (r.competitorId ?? "").toLowerCase().includes(q))
  );
  const countOf = (s: UnfoundWinner["status"]) => (rows ?? []).filter((r) => r.status === s).length;
  const suppliersInList = Array.from(new Map((rows ?? []).flatMap((r) => (r.supplier ? [[r.supplier.id, r.supplier.name] as const] : []))).entries())
    .sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div>
      <TabGuide storageKey="analisismercado-ganadores">
        Anota aquí los productos que ves ganando en la competencia pero que todavía ningún proveedor te ofrece — la semana se pone sola. Después vuelve a revisar la lista: cuando un proveedor ya lo tenga, dale a &quot;Pasar a Proponer&quot; y se abre la propuesta con la imagen, el nombre y los datos de la competencia ya llenos (solo te falta el costo del proveedor). Si ya no te interesa, márcalo como descartado.
      </TabGuide>

      <div className="max-w-xl bg-surface border border-rule rounded-md p-3.5 mb-5">
        <div className="text-[13px] font-semibold text-ink mb-2.5">{editingId ? "Editar producto" : "Registrar producto ganador"}</div>
        <div className="flex gap-3 mb-2.5">
          <div className="shrink-0">
            {imageUrl ? (
              <div className="flex flex-col items-center gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img loading="lazy" decoding="async" src={imageUrl} alt="Imagen del producto" className="w-24 h-24 object-cover rounded border border-rule cursor-pointer" />
                <button type="button" className="text-[11px] text-steel underline decoration-dotted cursor-pointer" onClick={() => setImageUrl("")}>Cambiar</button>
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
                className={`w-24 h-24 flex flex-col items-center justify-center gap-1 border-[1.5px] border-dashed rounded-md text-[11px] text-steel text-center px-1 cursor-pointer focus:outline-none ${
                  isDragOver ? "border-teal bg-teal/5" : "border-rule hover:border-teal focus:border-teal"
                }`}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={14} />}
                Pega, arrastra o haz clic
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])} />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <input className="w-full rounded border border-rule px-2.5 py-1.5 text-[13px]" placeholder="Nombre del producto" value={productName} onChange={(e) => setProductName(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <input className="rounded border border-rule px-2.5 py-1.5 text-[13px] min-w-0" placeholder="ID competencia" value={competitorId} onChange={(e) => setCompetitorId(e.target.value)} />
              <input className="rounded border border-rule px-2.5 py-1.5 text-[13px] min-w-0" placeholder="Precio ref. competencia" type="number" step="0.01" value={competitorPrice} onChange={(e) => setCompetitorPrice(e.target.value)} />
            </div>
          </div>
        </div>
        <label className="text-[12px] font-semibold text-steel">Proveedor (opcional)</label>
        <div className="mt-1">
          <SupplierSelect suppliers={suppliers} value={supplierId} onChange={setSupplierId} />
          {supplierId && (
            <button type="button" className="text-[11px] text-steel underline decoration-dotted cursor-pointer -mt-1 mb-2" onClick={() => setSupplierId("")}>Quitar proveedor</button>
          )}
        </div>
        <textarea className="w-full rounded border border-rule px-2.5 py-1.5 text-[13px] mb-2" rows={2} placeholder="Notas (opcional) — ej. dónde lo viste, qué le falta" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy || uploading} className="rounded bg-teal text-white px-3.5 py-1.5 text-[12.5px] font-semibold cursor-pointer disabled:opacity-60" onClick={submit}>
            {busy ? "Guardando…" : editingId ? "Guardar cambios" : "Registrar"}
          </button>
          {editingId && (
            <button type="button" className="text-[12px] text-steel underline decoration-dotted cursor-pointer" onClick={() => { resetForm(); setErr(""); }}>Cancelar</button>
          )}
          {!editingId && <span className="text-[11.5px] text-steel">La semana se pone sola.</span>}
        </div>
        {err && <div className="text-[12px] text-red mt-2">{err}</div>}
        {ok && <div className="text-[12px] text-teal mt-2">{ok}</div>}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {([
          ["PENDING", `Buscando proveedor (${countOf("PENDING")})`],
          ["PROPOSED", `Ya propuestos (${countOf("PROPOSED")})`],
          ["DISCARDED", `Descartados (${countOf("DISCARDED")})`],
          ["ALL", `Todos (${rows?.length ?? 0})`],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" className={`rounded-full border px-3 py-1 text-[12px] font-semibold cursor-pointer ${filter === key ? "border-teal bg-teal/10 text-teal" : "border-rule text-steel"}`} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
        <select className="rounded border border-rule px-2 py-1 text-[12px] bg-surface" value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
          <option value="">Todos los proveedores</option>
          <option value="none">Sin proveedor</option>
          {suppliersInList.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <input className="rounded border border-rule px-2.5 py-1 text-[12px] min-w-[180px] flex-1 max-w-xs" placeholder="Buscar por nombre o ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {rows === null ? (
        <div className="text-steel text-[13px]">Cargando…</div>
      ) : visible.length === 0 ? (
        <div className="text-steel text-[13.5px]">{rows.length === 0 ? "Todavía no hay productos registrados." : "No hay productos con este filtro."}</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {visible.map((r) => {
            const status = UNFOUND_STATUS_LABEL[r.status];
            return (
              <div key={r.id} className={`bg-surface border rounded-md p-3 flex items-start gap-3 ${editingId === r.id ? "border-teal" : "border-rule"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img loading="lazy" decoding="async" src={r.imageUrl} alt={r.productName} className="w-20 h-20 object-cover rounded border border-rule shrink-0 cursor-pointer" />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-semibold text-[13.5px] text-ink">{r.productName}</span>
                    <span className={`text-[11px] font-semibold ${status.color}`}>{status.text}</span>
                    <span className="text-[11px] text-steel">Semana {r.weekNumber}</span>
                  </div>
                  <div className="text-[12.5px] text-steel mt-1 flex flex-wrap gap-x-3">
                    <span>ID competencia: <b className="text-ink">{r.competitorId || "—"}</b></span>
                    <span>Precio ref.: <b className="text-ink">{r.competitorPrice !== null ? money(r.competitorPrice) : "—"}</b></span>
                    <span>Proveedor: <b className="text-ink">{r.supplier?.name ?? "—"}</b></span>
                  </div>
                  {r.status === "PENDING" && <MaxPurchasePrice productName={r.productName} competitorPrice={r.competitorPrice} />}
                  {r.notes && <div className="text-[12px] text-steel mt-1 italic">{r.notes}</div>}
                  <div className="text-[11px] text-steel mt-1">Registrado por {r.createdBy?.name ?? "admin"} — {formatDateTime(r.createdAt)}</div>
                  {r.status === "PROPOSED" && r.proposal && (
                    <div className="text-[12px] text-teal mt-1">Propuesta {r.proposal.code} — {PROPOSAL_STATUS_LABEL[r.proposal.status].text}</div>
                  )}
                  {r.status !== "PROPOSED" && (
                    <div className="flex flex-wrap items-center gap-3 mt-2 text-[12px]">
                      {r.status === "PENDING" && (
                        <button
                          type="button"
                          className="rounded bg-teal text-white px-2.5 py-1 font-semibold cursor-pointer"
                          onClick={() => onPropose({
                            unfoundId: r.id,
                            productName: r.productName,
                            imageUrl: r.imageUrl,
                            competitorId: r.competitorId ?? "",
                            competitorPrice: r.competitorPrice !== null ? String(r.competitorPrice) : "",
                            supplierId: r.supplier?.id ?? "",
                          })}
                        >
                          Pasar a Proponer
                        </button>
                      )}
                      <button type="button" className="text-blue font-semibold cursor-pointer" onClick={() => startEdit(r)}>Editar</button>
                      {r.status === "PENDING" ? (
                        <button type="button" disabled={rowBusy === r.id} className="text-steel font-semibold cursor-pointer disabled:opacity-60" onClick={() => setStatus(r.id, "DISCARDED")}>Descartar</button>
                      ) : (
                        <button type="button" disabled={rowBusy === r.id} className="text-steel font-semibold cursor-pointer disabled:opacity-60" onClick={() => setStatus(r.id, "PENDING")}>Reactivar</button>
                      )}
                      {confirmDeleteId === r.id ? (
                        <span className="text-red">
                          ¿Borrar para siempre?{" "}
                          <button type="button" disabled={rowBusy === r.id} className="font-semibold underline cursor-pointer" onClick={() => remove(r.id)}>Sí, borrar</button>{" "}
                          <button type="button" className="text-steel underline decoration-dotted cursor-pointer" onClick={() => setConfirmDeleteId(null)}>No</button>
                        </span>
                      ) : (
                        <button type="button" className="text-red font-semibold cursor-pointer" onClick={() => setConfirmDeleteId(r.id)}>Borrar</button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
