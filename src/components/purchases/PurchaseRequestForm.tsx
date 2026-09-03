"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Lock, Upload, Plus, X, FileText, Clock, Wallet } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";
import { PurchaseCatalogPicker, type CatalogItemDTO, type CatalogCreateDraft } from "./PurchaseCatalogPicker";
import { PurchaseSupplierPicker, type PurchaseSupplierDTO } from "./PurchaseSupplierPicker";
import type { SupplierPriceHistory } from "@/lib/purchases";

type PriceStats = { count: number; min: number | null; avg: number | null; max: number | null; last3Avg: number | null };
type SupplierCreditDTO = { id: string; amount: number; reason: string; status: "AVAILABLE" | "RESERVED" | "APPLIED" | "REFUNDED"; createdAt: string };
type QuoteReadResult = {
  readTotal: number | null;
  productNameFound: string | null;
  referenceCodeFound: string | null;
  matches: boolean;
  suggestedCatalogItem: { id: string; name: string } | null;
};

type Line = { catalogItem: CatalogItemDTO | null; productQuery: string; createDraft: CatalogCreateDraft | null; quantity: string; unitCost: string; ivaIncluded: boolean; stats: PriceStats | null };
const emptyLine = (): Line => ({ catalogItem: null, productQuery: "", createDraft: null, quantity: "", unitCost: "", ivaIncluded: false, stats: null });

// Confirmado 2026-08-03: algunos proveedores cobran el 15% de IVA aparte del
// costo por unidad que se escribe en el formulario — sin esto, el total no
// coincide con el de la cotización. El valor CON IVA (no el que se tipeó) es
// el que de verdad se paga, así que es ese el que se guarda y compara contra
// el historial de precios — nunca el "antes de IVA".
const IVA_RATE = 0.15;
function effectiveLineUnitCost(l: { unitCost: string; ivaIncluded: boolean }) {
  const raw = Number(l.unitCost) || 0;
  return l.ivaIncluded ? Math.round(raw * (1 + IVA_RATE) * 100) / 100 : raw;
}

type Draft = {
  lines: { catalogItem: CatalogItemDTO | null; productQuery: string; createDraft: CatalogCreateDraft | null; quantity: string; unitCost: string; ivaIncluded: boolean }[];
  supplier: PurchaseSupplierDTO | null;
  bankAccountId: string | null;
  quoteImageUrl: string | null;
  verifyResult: QuoteReadResult | null;
  manualCodeConfirm: boolean;
  purchaseOrderUrl: string | null;
  poVerifyResult: { readTotal: number | null; matches: boolean } | null;
  shippingIncluded: boolean;
  shippingCarrierPending: boolean;
  carrier: PurchaseSupplierDTO | null;
  carrierBankAccountId: string | null;
  shippingCostTotal: string;
  shippingPaymentMethod: "TRANSFER" | "PETTY_CASH";
  shippingPaymentTiming: "WITH_PURCHASE" | "ON_DELIVERY";
  justification: string;
  // Confirmado 2026-08-08: cambio de política — "Corregir y reenviar" ya NO
  // crea una solicitud nueva; corrige la MISMA (mismo groupId/código SC-XXX)
  // en su lugar. editingGroupId presente = el envío va a
  // /api/purchase-requests/group/{editingGroupId}/resubmit en vez de crear
  // una nueva. nextAttemptNumber es solo informativo para el aviso de arriba
  // (el servidor recalcula el real).
  editingGroupId?: string;
  nextAttemptNumber?: number;
};

// Confirmado 2026-07-31: si la persona sale de la página a medias, no debe
// perder lo que ya llevaba avanzado — se guarda un borrador en localStorage
// (los archivos ya se subieron a Storage apenas se eligen, así que lo que se
// persiste son solo URLs y texto, todo serializable) y se restaura solo, con
// un aviso arriba para que quede claro que es lo que ya tenía sin terminar.
// v2: el proveedor pasó a tener bankAccounts[] en vez de campos bancarios
// sueltos — un borrador viejo (v1) sin ese arreglo tumbaba la página entera
// al restaurarlo (PurchaseSupplierPicker llamaba .map sobre undefined). v3:
// se agregó email y RUC/cédula por cuenta — normalizeSupplier() de todas
// formas rellena lo que falte, por las dudas.
export const DRAFT_KEY = "daflow.purchaseRequestDraft.v3";

function normalizeSupplier(s: PurchaseSupplierDTO | null | undefined): PurchaseSupplierDTO | null {
  if (!s) return null;
  return {
    ...s,
    email: s.email ?? null,
    bankAccounts: (Array.isArray(s.bankAccounts) ? s.bankAccounts : []).map((a) => ({
      ...a,
      holderIdType: a.holderIdType ?? null,
      holderIdNumber: a.holderIdNumber ?? null,
    })),
  };
}

function draftHasContent(d: Pick<Draft, "lines" | "supplier" | "quoteImageUrl" | "purchaseOrderUrl" | "justification">) {
  return (
    d.lines.some((l) => l.catalogItem || l.productQuery || l.quantity || l.unitCost || (l.createDraft?.creating && (l.createDraft.newName.trim() || l.createDraft.photos.length > 0))) ||
    !!d.supplier ||
    !!d.quoteImageUrl ||
    !!d.purchaseOrderUrl ||
    !!d.justification.trim()
  );
}

// Confirmado 2026-07-31: una cotización suele traer varios productos — se
// arma como una lista de líneas (cada una con su propio insumo/cantidad/
// costo, comparada contra SU propio historial), pero comparten un solo
// proveedor, una sola cotización, y un solo envío/justificación, porque es
// una sola compra.
// Confirmado 2026-09-03: emergencyOnly (pedido explícito del usuario) — solo
// true cuando quien entra está bloqueado de solicitar normalmente (hoy
// Bryan) pero tiene la vía de respaldo para cuando Jariel/Nairoby no están
// disponibles. Exige motivo obligatorio y lo manda como isEmergency +
// emergencyReason — el servidor es quien de verdad decide si se respeta
// (ver POST /api/purchase-requests), esto es solo la UI/UX de esa vía.
export function PurchaseRequestForm({ deptId, isAdmin, emergencyOnly = false }: { deptId: string; isAdmin: boolean; emergencyOnly?: boolean }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [emergencyReason, setEmergencyReason] = useState("");
  const [supplier, setSupplier] = useState<PurchaseSupplierDTO | null>(null);
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);

  // Confirmado 2026-08-12: pedido explícito del usuario — al elegir
  // proveedor, se ofrece usar el crédito pendiente que ya se tenga con él
  // (de un reporte urgente resuelto, o cargado a mano) para descontarlo del
  // total a pagar. Se reserva de una vez al enviar la solicitud (nadie más
  // lo puede usar mientras tanto) — ver reserveCreditsForGroup.
  const [availableCredits, setAvailableCredits] = useState<SupplierCreditDTO[]>([]);
  const [selectedCreditIds, setSelectedCreditIds] = useState<string[]>([]);
  const [creditExceedsMsg, setCreditExceedsMsg] = useState("");
  const [manualCreditOpen, setManualCreditOpen] = useState(false);
  const [manualCreditAmount, setManualCreditAmount] = useState("");
  const [manualCreditReason, setManualCreditReason] = useState("");
  const [manualCreditProofUrl, setManualCreditProofUrl] = useState<string | null>(null);
  const [manualCreditProofName, setManualCreditProofName] = useState<string | null>(null);
  const [uploadingManualCreditProof, setUploadingManualCreditProof] = useState(false);
  const [savingManualCredit, setSavingManualCredit] = useState(false);
  const { onPaste: onPasteManualCredit, onMouseEnter: onManualCreditHoverIn, onMouseLeave: onManualCreditHoverOut } = usePasteFile((file) => uploadManualCreditProof(file));
  const manualCreditFileInputRef = useRef<HTMLInputElement>(null);

  const [quoteFile, setQuoteFile] = useState<File | null>(null);
  const [quoteImageUrl, setQuoteImageUrl] = useState<string | null>(null);
  const [uploadingQuote, setUploadingQuote] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<QuoteReadResult | null>(null);
  const [manualCodeConfirm, setManualCodeConfirm] = useState(false);
  // Confirmado 2026-08-17: una vez que la IA confirma que el monto coincide,
  // el documento queda anclado — no se puede cambiar ni "eliminar" con un
  // clic, para que no se pueda subir el documento real, dejar que pase la
  // verificación, y después cambiarlo por otro sin que quede rastro de cuál
  // fue el que realmente se validó. Solo se desbloquea con una confirmación
  // explícita, y al desbloquear se pierde el archivo y la verificación por
  // completo — obliga a subir y verificar de nuevo, nunca a reutilizar el
  // resultado viejo con un archivo distinto.
  const [confirmUnlockQuote, setConfirmUnlockQuote] = useState(false);
  const { onPaste: onPasteQuote, onMouseEnter: onPasteQuoteHoverIn, onMouseLeave: onPasteQuoteHoverOut, onDragOver: onDragOverQuote, onDragLeave: onDragLeaveQuote, onDrop: onDropQuote, isDragOver: isDragOverQuote } = usePasteFile((file) => handleQuoteFile(file));
  const quoteFileInputRef = useRef<HTMLInputElement>(null);

  const [purchaseOrderFile, setPurchaseOrderFile] = useState<File | null>(null);
  const [purchaseOrderUrl, setPurchaseOrderUrl] = useState<string | null>(null);
  const [uploadingPurchaseOrder, setUploadingPurchaseOrder] = useState(false);
  const [poVerifying, setPoVerifying] = useState(false);
  const [poVerifyResult, setPoVerifyResult] = useState<{ readTotal: number | null; matches: boolean } | null>(null);
  // Confirmado 2026-09-03: la lectura automática al subir el archivo solo se
  // intentaba una vez — si fallaba por algo pasajero (conexión, timeout de la
  // IA), se quedaba trabada para siempre sin ningún aviso claro ni forma de
  // reintentar. Este contador deja que el useEffect de más abajo reintente
  // solo, con espera creciente, hasta 3 veces antes de pedirle a la persona
  // que suba una foto más clara — así no se reintenta sin límite un caso
  // donde la foto de verdad no se puede leer (cada lectura le cuesta a la
  // empresa).
  const [poVerifyAttempts, setPoVerifyAttempts] = useState(0);
  const [confirmUnlockPO, setConfirmUnlockPO] = useState(false);
  const { onPaste: onPastePurchaseOrder, onMouseEnter: onPastePOHoverIn, onMouseLeave: onPastePOHoverOut, onDragOver: onDragOverPO, onDragLeave: onDragLeavePO, onDrop: onDropPO, isDragOver: isDragOverPO } = usePasteFile((file) => handlePurchaseOrderFile(file));
  const purchaseOrderFileInputRef = useRef<HTMLInputElement>(null);

  // Confirmado 2026-08-07: antes venía marcado por default (asumía "envío
  // incluido"), lo que hacía que muchas solicitudes se enviaran sin costo de
  // flete cuando en realidad SÍ se cobraba aparte. Ahora arranca sin marcar
  // — cada quien confirma explícitamente con un clic cuando el proveedor de
  // verdad no cobra flete aparte (ej. entrega a domicilio sin costo extra).
  const [shippingIncluded, setShippingIncluded] = useState(false);
  // Confirmado 2026-08-11: pedido explícito del usuario — a veces todavía
  // no se sabe ni el transportista ni el costo real del flete al momento
  // de solicitar. Con esto marcado, esos dos campos dejan de ser
  // obligatorios y quedan pendientes de completar después desde "Mis
  // solicitudes" (mismo patrón que la orden de compra).
  const [shippingCarrierPending, setShippingCarrierPending] = useState(false);
  const [carrier, setCarrier] = useState<PurchaseSupplierDTO | null>(null);
  const [carrierBankAccountId, setCarrierBankAccountId] = useState<string | null>(null);
  const [shippingCostTotal, setShippingCostTotal] = useState("");
  const [shippingPaymentMethod, setShippingPaymentMethod] = useState<"TRANSFER" | "PETTY_CASH">("TRANSFER");
  // Confirmado 2026-08-03: si el flete se cobra aparte, se elige si se paga
  // junto con la compra (como antes) o si queda pendiente hasta que llegue
  // la mercadería — algunos transportistas solo dan su cuenta al entregar.
  const [shippingPaymentTiming, setShippingPaymentTiming] = useState<"WITH_PURCHASE" | "ON_DELIVERY">("WITH_PURCHASE");

  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");

  const [hydrated, setHydrated] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [resubmitAttemptHint, setResubmitAttemptHint] = useState<number | null>(null);

  // Confirmado 2026-08-06: al elegir un producto, además del mínimo/promedio/
  // máximo global ya existente, se muestra el historial POR PROVEEDOR (más
  // barato primero) — para poder elegir a quién comprarle antes de fijar el
  // proveedor de la solicitud. No se guarda en el borrador (se recalcula al
  // restaurar, igual que `stats`).
  const [supplierComparisons, setSupplierComparisons] = useState<Record<number, SupplierPriceHistory[]>>({});

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function fetchLineStats(idx: number, catalogItemId: string) {
    fetch(`/api/purchase-catalog/${catalogItemId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => updateLine(idx, { stats: data?.stats ?? null }))
      .catch(() => updateLine(idx, { stats: null }));
  }

  function fetchSupplierComparison(idx: number, catalogItemId: string) {
    fetch(`/api/purchase-catalog/${catalogItemId}/supplier-comparison`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: SupplierPriceHistory[]) => setSupplierComparisons((m) => ({ ...m, [idx]: data })))
      .catch(() => setSupplierComparisons((m) => ({ ...m, [idx]: [] })));
  }

  function setLineCatalogItem(idx: number, item: CatalogItemDTO | null) {
    updateLine(idx, { catalogItem: item, productQuery: "", createDraft: null, stats: null });
    setSupplierComparisons((m) => { const next = { ...m }; delete next[idx]; return next; });
    if (!item) return;
    fetchLineStats(idx, item.id);
    fetchSupplierComparison(idx, item.id);
  }

  // Confirmado 2026-08-12: apenas se elige (o se restaura del borrador) un
  // proveedor, se consulta su crédito disponible — misma ruta que ya usa la
  // Bandeja de aprobación al pagar, reusada acá para ofrecerlo desde antes.
  useEffect(() => {
    setSelectedCreditIds([]);
    setCreditExceedsMsg("");
    if (!supplier?.id) {
      setAvailableCredits([]);
      return;
    }
    fetch(`/api/purchase-suppliers/${supplier.id}/credit-balance`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setAvailableCredits(data?.credits ?? []))
      .catch(() => setAvailableCredits([]));
  }, [supplier?.id]);

  function toggleCredit(id: string) {
    setCreditExceedsMsg("");
    setSelectedCreditIds((ids) => {
      if (ids.includes(id)) return ids.filter((x) => x !== id);
      const credit = availableCredits.find((c) => c.id === id);
      if (!credit) return ids;
      const currentTotal = availableCredits.filter((c) => ids.includes(c.id)).reduce((s, c) => s + c.amount, 0);
      if (currentTotal + credit.amount > total) {
        setCreditExceedsMsg(
          `Este crédito ($${credit.amount.toFixed(2)}) haría que el crédito aplicado supere el total de esta solicitud ($${total.toFixed(2)}) — avísale al admin para que lo revise antes de aplicarlo, en vez de marcarlo aquí.`
        );
        return ids;
      }
      return [...ids, id];
    });
  }

  async function uploadManualCreditProof(file: File) {
    setErr("");
    setUploadingManualCreditProof(true);
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "supplier-credits");
    setUploadingManualCreditProof(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setManualCreditProofUrl(uploaded.url);
    setManualCreditProofName(uploaded.name);
  }

  async function saveManualCredit() {
    if (!supplier) return;
    const amt = Number(manualCreditAmount);
    if (!amt || amt <= 0) {
      setErr("Ingresa un monto válido para el crédito.");
      return;
    }
    if (!manualCreditReason.trim()) {
      setErr("Describe el motivo del crédito.");
      return;
    }
    if (!manualCreditProofUrl) {
      setErr("Sube el comprobante — captura del chat o documento donde el proveedor acepta.");
      return;
    }
    setSavingManualCredit(true);
    setErr("");
    const res = await fetch(`/api/purchase-suppliers/${supplier.id}/credits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amt, reason: manualCreditReason.trim(), proofUrl: manualCreditProofUrl, proofName: manualCreditProofName }),
    });
    setSavingManualCredit(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo guardar el crédito.");
      return;
    }
    setAvailableCredits((cs) => [...cs, { id: data.id, amount: data.amount, reason: data.reason, status: data.status, createdAt: data.createdAt }]);
    setManualCreditOpen(false);
    setManualCreditAmount("");
    setManualCreditReason("");
    setManualCreditProofUrl(null);
    setManualCreditProofName(null);
  }

  function addLine() {
    setLines((ls) => [...ls, emptyLine()]);
  }
  function removeLine(idx: number) {
    setLines((ls) => (ls.length > 1 ? ls.filter((_, i) => i !== idx) : ls));
    // supplierComparisons vive fuera de `lines` (indexado por posición) — hay
    // que reacomodarlo igual que el filter de arriba, si no se desalinea.
    setSupplierComparisons((m) => {
      const next: Record<number, SupplierPriceHistory[]> = {};
      Object.entries(m).forEach(([k, v]) => {
        const i = Number(k);
        if (i < idx) next[i] = v;
        else if (i > idx) next[i - 1] = v;
      });
      return next;
    });
  }

  // Restaura el borrador (si hay uno) una sola vez al montar, y recién
  // después habilita el autoguardado — así no se pisa el borrador guardado
  // con el estado vacío inicial antes de leerlo.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d: Draft = JSON.parse(raw);
        const restoredLines: Line[] = (d.lines?.length ? d.lines : [emptyLine()]).map((l) => ({ ...l, productQuery: l.productQuery ?? "", createDraft: l.createDraft ?? null, ivaIncluded: l.ivaIncluded ?? false, stats: null }));
        setLines(restoredLines);
        setSupplier(normalizeSupplier(d.supplier));
        setBankAccountId(d.bankAccountId ?? null);
        setQuoteImageUrl(d.quoteImageUrl ?? null);
        setVerifyResult(d.verifyResult ?? null);
        setManualCodeConfirm(d.manualCodeConfirm ?? false);
        setPurchaseOrderUrl(d.purchaseOrderUrl ?? null);
        setPoVerifyResult(d.poVerifyResult ?? null);
        setShippingIncluded(d.shippingIncluded ?? false);
        setShippingCarrierPending(d.shippingCarrierPending ?? false);
        setCarrier(normalizeSupplier(d.carrier));
        setCarrierBankAccountId(d.carrierBankAccountId ?? null);
        setShippingCostTotal(d.shippingCostTotal ?? "");
        setShippingPaymentMethod(d.shippingPaymentMethod ?? "TRANSFER");
        setShippingPaymentTiming(d.shippingPaymentTiming ?? "WITH_PURCHASE");
        setJustification(d.justification ?? "");
        setEditingGroupId(d.editingGroupId ?? null);
        setResubmitAttemptHint(d.nextAttemptNumber ?? null);
        restoredLines.forEach((l, i) => { if (l.catalogItem) { fetchLineStats(i, l.catalogItem.id); fetchSupplierComparison(i, l.catalogItem.id); } });
        setDraftRestored(draftHasContent(d));
      }
    } catch {
      // Borrador corrupto o ilegible — se ignora y se arranca en blanco.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const draft: Draft = {
      lines: lines.map(({ catalogItem, productQuery, createDraft, quantity, unitCost, ivaIncluded }) => ({ catalogItem, productQuery, createDraft, quantity, unitCost, ivaIncluded })),
      supplier,
      bankAccountId,
      quoteImageUrl,
      verifyResult,
      manualCodeConfirm,
      purchaseOrderUrl,
      poVerifyResult,
      shippingIncluded,
      shippingCarrierPending,
      carrier,
      carrierBankAccountId,
      shippingCostTotal,
      shippingPaymentMethod,
      shippingPaymentTiming,
      justification,
      editingGroupId: editingGroupId ?? undefined,
      nextAttemptNumber: resubmitAttemptHint ?? undefined,
    };
    if (draftHasContent(draft)) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } else {
      localStorage.removeItem(DRAFT_KEY);
    }
  }, [hydrated, lines, supplier, bankAccountId, quoteImageUrl, verifyResult, manualCodeConfirm, purchaseOrderUrl, poVerifyResult, shippingIncluded, shippingCarrierPending, carrier, carrierBankAccountId, shippingCostTotal, shippingPaymentMethod, shippingPaymentTiming, justification, editingGroupId, resubmitAttemptHint]);

  function resetForm() {
    setLines([emptyLine()]);
    setSupplier(null);
    setBankAccountId(null);
    setQuoteFile(null);
    setQuoteImageUrl(null);
    setVerifyResult(null);
    setManualCodeConfirm(false);
    setPurchaseOrderFile(null);
    setPurchaseOrderUrl(null);
    setPoVerifyResult(null);
    setCarrier(null);
    setCarrierBankAccountId(null);
    setShippingCostTotal("");
    setShippingIncluded(false);
    setShippingCarrierPending(false);
    setShippingPaymentMethod("TRANSFER");
    setShippingPaymentTiming("WITH_PURCHASE");
    setJustification("");
    setDraftRestored(false);
    setEditingGroupId(null);
    setResubmitAttemptHint(null);
    setAvailableCredits([]);
    setSelectedCreditIds([]);
    setCreditExceedsMsg("");
    setManualCreditOpen(false);
    setManualCreditAmount("");
    setManualCreditReason("");
    setManualCreditProofUrl(null);
    setManualCreditProofName(null);
  }

  function discardDraft() {
    localStorage.removeItem(DRAFT_KEY);
    resetForm();
    setErr("");
  }

  const lineTotals = lines.map((l) => (Number(l.quantity) || 0) * effectiveLineUnitCost(l));
  const totalQty = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const total = lineTotals.reduce((s, t) => s + t, 0);

  // Confirmado 2026-08-31: si el total cambia (cantidad, costo, IVA, o
  // agregar/quitar un producto) DESPUÉS de que la cotización u orden de
  // compra ya se verificó contra el total anterior, ese "coincide" queda
  // obsoleto — invalida ambas verificaciones para forzar un chequeo nuevo
  // contra el total real antes de poder enviar (submit() ya exige
  // quoteVerified/poVerifyResult.matches, así que ponerlos en null vuelve a
  // bloquear el envío hasta reverificar).
  const lastVerifiedTotalRef = useRef<number | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (lastVerifiedTotalRef.current !== null && lastVerifiedTotalRef.current !== total) {
      setVerifyResult(null);
      setPoVerifyResult(null);
    }
    lastVerifiedTotalRef.current = total;
  }, [hydrated, total]);

  // Confirmado 2026-08-17: pedido explícito del usuario — cuando la
  // cotización solo trae código (sin nombre de producto), antes el total que
  // leía la IA (readTotal) se descartaba en silencio: solo se comparaba la
  // orden de compra contra lo escrito. Si el proveedor ya tenía un crédito
  // pendiente y lo aplicó directo en la cotización (el "total a transferir"
  // que puso ahí ya viene descontado), esa diferencia nunca se detectaba ni
  // se registraba como crédito — se terminaba pagando de más. Con esto, si
  // el total leído de la cotización es menor a lo escrito, se ofrece
  // registrar la diferencia como crédito de una vez (ver bloque de
  // "Cotización" más abajo).
  const quoteCreditGap =
    verifyResult?.referenceCodeFound && verifyResult.readTotal !== null && total - verifyResult.readTotal > 0.01
      ? total - verifyResult.readTotal
      : null;

  // Cada línea se compara contra SU propio historial — el envío (si no está
  // incluido) se reparte proporcionalmente por cantidad, igual que hace el
  // servidor, para que la vista previa coincida con lo que de verdad valida.
  // El costo ya incluye el IVA cuando aplica, para que el historial refleje
  // siempre el precio real pagado, no el que se tipeó antes de sumarlo.
  const overThresholdLines = lines
    .map((l, i) => {
      if (!l.stats || l.stats.last3Avg === null) return null;
      const qty = Number(l.quantity) || 0;
      const cost = effectiveLineUnitCost(l);
      const lineShipping = shippingIncluded || !shippingCostTotal || totalQty === 0 ? 0 : (Number(shippingCostTotal) * qty) / totalQty;
      const effCost = cost + (qty > 0 ? lineShipping / qty : 0);
      return effCost > l.stats.last3Avg ? { idx: i, name: l.catalogItem?.name ?? "?", effCost, last3Avg: l.stats.last3Avg } : null;
    })
    .filter((x): x is { idx: number; name: string; effCost: number; last3Avg: number } => x !== null);
  const overThreshold = overThresholdLines.length > 0;

  // Confirmado 2026-08-06: si el proveedor elegido para toda la solicitud no
  // es el más barato conocido para algún producto, también hace falta
  // justificar — mismo campo de justificación, motivo adicional.
  const supplierNotCheapestLines = lines
    .map((l, i) => {
      const comparison = supplierComparisons[i];
      if (!l.catalogItem || !comparison || comparison.length === 0 || !supplier) return null;
      const cheapest = comparison[0];
      if (cheapest.supplierId === supplier.id) return null;
      return { idx: i, name: l.catalogItem.name, cheapestSupplierName: cheapest.supplierName, cheapestPrice: cheapest.latest };
    })
    .filter((x): x is { idx: number; name: string; cheapestSupplierName: string; cheapestPrice: number } => x !== null);
  const supplierNotCheapest = supplierNotCheapestLines.length > 0;
  const needsJustification = overThreshold || supplierNotCheapest;

  // Confirmado 2026-08-06: bug real encontrado — si alguien escribía una
  // justificación (porque el precio superaba el historial) y LUEGO quitaba o
  // cambiaba ese producto (catalogItem vuelve a null), la justificación se
  // quedaba huérfana en el borrador guardado. overThreshold pasa a false (no
  // hay catalogItem con qué compararlo), así que nada se ve en pantalla, pero
  // `justification` seguía siendo texto no vacío — suficiente para que
  // draftHasContent() marcara el borrador como "con contenido" y mostrara el
  // aviso de "retomando", aunque todos los campos visibles estuvieran vacíos.
  // Se limpia sola en cuanto ya no queda ningún producto elegido en ninguna
  // línea (nunca durante la carga async de stats de un producto que sí sigue
  // elegido, para no borrar una justificación válida a medio cargar).
  const hasAnyCatalogItem = lines.some((l) => l.catalogItem);
  useEffect(() => {
    if (hydrated && !hasAnyCatalogItem && justification) setJustification("");
  }, [hydrated, hasAnyCatalogItem, justification]);

  // Lo que de verdad hay guardado en el borrador, para mostrarlo en el aviso
  // de "retomando" — así se ve a qué se refiere en vez de solo un mensaje
  // genérico, y si algo se ve vacío ahí es porque de verdad no tenía nada.
  const draftSummaryParts: string[] = [];
  lines.forEach((l) => {
    if (l.catalogItem) draftSummaryParts.push(`${l.catalogItem.name}${l.quantity ? ` · ${l.quantity} un.` : ""}`);
    else if (l.createDraft?.creating && l.createDraft.newName.trim()) draftSummaryParts.push(`"${l.createDraft.newName.trim()}" (creando, sin terminar)`);
    else if (l.productQuery.trim()) draftSummaryParts.push(`"${l.productQuery.trim()}" (sin seleccionar todavía)`);
  });
  if (supplier) draftSummaryParts.push(`Proveedor: ${supplier.name}`);
  if (quoteImageUrl) draftSummaryParts.push("Cotización ya subida");
  if (purchaseOrderUrl) draftSummaryParts.push("Orden de compra ya subida");

  async function handleQuoteFile(file: File) {
    setQuoteFile(file);
    setVerifyResult(null);
    setManualCodeConfirm(false);
    setUploadingQuote(true);
    setErr("");
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-quotes");
    setUploadingQuote(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setQuoteImageUrl(uploaded.url);
  }

  async function handlePurchaseOrderFile(file: File) {
    setPurchaseOrderFile(file);
    setPoVerifyResult(null);
    setPoVerifyAttempts(0);
    setUploadingPurchaseOrder(true);
    setErr("");
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-orders");
    setUploadingPurchaseOrder(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setPurchaseOrderUrl(uploaded.url);
    // La verificación en sí la dispara el useEffect de más abajo (mira
    // needsPurchaseOrder/purchaseOrderUrl/poVerifyResult) — así también
    // reintenta solo si el intento automático falla, en vez de depender de
    // que este momento exacto tenga todo lo necesario listo.
  }

  async function verifyPurchaseOrder(url: string) {
    setPoVerifying(true);
    const res = await fetch("/api/purchase-requests/verify-purchase-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchaseOrderUrl: url, expectedTotal: total }),
    }).catch(() => null);
    setPoVerifying(false);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok) {
      setPoVerifyAttempts((n) => n + 1);
      return;
    }
    setPoVerifyResult(data);
    setPoVerifyAttempts(0);
  }

  async function verifyQuote() {
    if (!quoteImageUrl || total <= 0) return;
    setVerifying(true);
    setErr("");
    const res = await fetch("/api/purchase-requests/verify-quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quoteImageUrl, expectedTotal: total }),
    });
    setVerifying(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo leer la cotización.");
      return;
    }
    setVerifyResult(data);
  }

  const quoteVerified = verifyResult?.matches || (verifyResult?.referenceCodeFound && manualCodeConfirm);
  // Confirmado 2026-07-31: cuando la IA no encuentra nombre de producto en la
  // cotización, solo un código, la orden de compra pasa a ser obligatoria —
  // es el único respaldo real de qué se está comprando y solicitando pagar.
  const needsPurchaseOrder = !!verifyResult?.referenceCodeFound && !verifyResult?.productNameFound;
  const poAnchored = !!poVerifyResult?.matches;

  // Confirmado 2026-09-03: reintenta sola la lectura de la orden de compra
  // cuando falta (recién subida, o el borrador guardado se quedó sin
  // verificar de una sesión anterior) y también cuando el intento previo
  // falló — con espera creciente (0s, 3s, 8s) para no golpear la IA de
  // inmediato tres veces seguidas. Se detiene a los 3 intentos fallidos: si
  // la foto de verdad no se puede leer, seguir reintentando para siempre
  // solo generaría gasto sin resolver nada — ahí se le pide a la persona que
  // suba una foto más clara.
  useEffect(() => {
    if (!needsPurchaseOrder || !purchaseOrderUrl || total <= 0) return;
    if (poVerifyResult || poVerifying) return;
    if (poVerifyAttempts >= 3) return;
    const delay = poVerifyAttempts === 0 ? 0 : poVerifyAttempts === 1 ? 3000 : 8000;
    const t = setTimeout(() => verifyPurchaseOrder(purchaseOrderUrl), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsPurchaseOrder, purchaseOrderUrl, poVerifyResult, poVerifying, total, poVerifyAttempts]);
  const validLines = lines.filter((l) => l.catalogItem && Number(l.quantity) > 0 && Number(l.unitCost) > 0);

  async function submit() {
    if (validLines.length === 0 || validLines.length !== lines.length || !supplier || !quoteImageUrl) {
      setErr("Completa producto, mercadería o insumo, cantidad y costo de cada línea, el proveedor, y la cotización.");
      return;
    }
    if (emergencyOnly && !editingGroupId && !emergencyReason.trim()) {
      setErr("Escribe el motivo de la solicitud de emergencia (ej. \"Jariel no disponible\").");
      return;
    }
    if (!quoteVerified) {
      setErr("Verifica la cotización antes de enviar.");
      return;
    }
    if (needsPurchaseOrder && !purchaseOrderUrl) {
      setErr("La cotización solo trae un código, sin nombre de producto — sube la orden de compra antes de enviar.");
      return;
    }
    if (needsPurchaseOrder && !poVerifyResult?.matches) {
      setErr("El monto de la orden de compra todavía no está verificado — debe coincidir con lo que escribiste.");
      return;
    }
    if (!shippingIncluded && !carrier && !shippingCarrierPending) {
      setErr("Elige el transportista, ya que el envío no está incluido — o marca que todavía no lo sabes.");
      return;
    }
    const supplierAccounts = supplier.bankAccounts ?? [];
    if (supplierAccounts.length === 0) {
      setErr("Este proveedor no tiene ninguna cuenta bancaria registrada — agrégale una cuenta antes de enviar la solicitud.");
      return;
    }
    if (!bankAccountId) {
      setErr("Elige la cuenta bancaria del proveedor a la que se le paga.");
      return;
    }
    if (needsJustification && !justification.trim()) {
      setErr(
        overThreshold && supplierNotCheapest
          ? "Uno o más productos están por encima del historial, y hay un proveedor más barato para alguno — agrega una justificación."
          : overThreshold
          ? "Uno o más productos están por encima del historial — agrega una justificación."
          : "Hay un proveedor más barato para uno o más productos — agrega una justificación."
      );
      return;
    }
    setBusy(true);
    setErr("");
    const body = {
      items: lines.map((l) => ({ catalogItemId: l.catalogItem!.id, quantity: Number(l.quantity), unitCost: effectiveLineUnitCost(l) })),
      supplierId: supplier.id,
      bankAccountId,
      quoteImageUrl,
      quoteReadTotal: verifyResult?.readTotal ?? null,
      quoteReferenceCode: verifyResult?.referenceCodeFound ?? null,
      purchaseOrderUrl,
      shippingIncluded,
      shippingCarrierPending: !shippingIncluded && shippingCarrierPending,
      carrierId: shippingIncluded ? null : carrier?.id,
      shippingCostTotal: shippingIncluded ? null : Number(shippingCostTotal) || null,
      shippingPaymentMethod: shippingIncluded ? null : shippingPaymentMethod,
      shippingPaymentTiming: shippingIncluded ? null : shippingPaymentTiming,
      carrierBankAccountId: shippingIncluded ? null : carrierBankAccountId,
      justification: needsJustification ? justification.trim() : null,
      appliedCreditIds: selectedCreditIds,
      isEmergency: emergencyOnly,
      emergencyReason: emergencyOnly ? emergencyReason.trim() : null,
    };
    // Confirmado 2026-08-08: cambio de política — corregir una solicitud
    // rechazada YA NO crea una nueva (eso hacía crecer la lista con
    // duplicados del mismo pedido, ej. SC-004/005/006 del mismo producto).
    // Ahora corrige la MISMA en su lugar: mismo groupId y mismo código
    // SC-XXX, el servidor solo incrementa attemptNumber.
    const res = editingGroupId
      ? await fetch(`/api/purchase-requests/group/${editingGroupId}/resubmit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      : await fetch("/api/purchase-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, deptId }),
        });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo enviar la solicitud.");
      return;
    }
    setToast(editingGroupId ? "✅ Solicitud corregida y reenviada — te llegará una notificación cuando se apruebe." : "✅ Solicitud enviada — te llegará una notificación cuando se apruebe.");
    localStorage.removeItem(DRAFT_KEY);
    resetForm();
    router.refresh();
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-4.5">
      {emergencyOnly && (
        <div className="bg-red/10 border border-red/40 rounded-md px-3.5 py-2.5 mb-4">
          <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-red mb-1.5">
            <AlertTriangle size={14} /> Solicitud de emergencia
          </div>
          <div className="text-[12px] text-steel mb-2.5">
            Usa esto SOLO si hoy Jariel y Nairoby no están disponibles para solicitar. Esta solicitud no cae en tu propia bandeja — la aprueba y paga directamente el admin.
          </div>
          {editingGroupId ? (
            <div className="text-[11.5px] text-steel-dim italic">Se corrige y reenvía con el mismo motivo de emergencia original.</div>
          ) : (
            <>
              <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Motivo (obligatorio)</label>
              <textarea
                className="w-full rounded border border-red/40 px-2.5 py-2 text-[12.5px]"
                rows={2}
                placeholder='Ej. "Jariel no disponible hoy y es urgente"'
                value={emergencyReason}
                onChange={(e) => setEmergencyReason(e.target.value)}
              />
            </>
          )}
        </div>
      )}
      {editingGroupId && (
        <div className="bg-gold/10 border border-gold/35 rounded-md px-3.5 py-2.5 mb-4 text-[12.5px]" style={{ color: "#D9A441" }}>
          <AlertTriangle size={14} className="inline mr-1.5 -mt-0.5" />
          Estás corrigiendo esta misma solicitud rechazada{resubmitAttemptHint ? ` — este será tu ${resubmitAttemptHint === 2 ? "2do" : resubmitAttemptHint === 3 ? "3er" : `${resubmitAttemptHint}to`} intento` : ""}. No se crea una solicitud nueva, se corrige la misma. Revisa qué faltaba antes de enviar de nuevo.
        </div>
      )}
      {draftRestored && (
        <div className="bg-teal/10 border border-teal/35 rounded-md px-3.5 py-2.5 mb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[12.5px] text-teal">
              <Clock size={15} /> Retomando tu solicitud sin terminar — no se perdió nada.
            </div>
            <button type="button" className="text-[11.5px] text-red font-semibold cursor-pointer whitespace-nowrap" onClick={discardDraft}>
              Descartar y empezar de nuevo
            </button>
          </div>
          {draftSummaryParts.length > 0 ? (
            <ul className="mt-1.5 pl-5 text-[11.5px] text-teal/90 list-disc">
              {draftSummaryParts.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          ) : (
            <div className="mt-1.5 text-[11.5px] text-steel">Todavía no hay nada que mostrar de este borrador — puedes descartarlo y empezar de nuevo.</div>
          )}
        </div>
      )}

      <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Productos</label>
      <div className="flex flex-col gap-3 mb-2">
        {lines.map((line, idx) => (
          <div key={idx} className="bg-surface2 border border-rule rounded-md p-3">
            <div className="flex items-start gap-2 mb-2.5">
              <div className="flex-1 min-w-0">
                <PurchaseCatalogPicker
                  value={line.catalogItem}
                  onChange={(item) => setLineCatalogItem(idx, item)}
                  isAdmin={isAdmin}
                  defaultQuery={line.productQuery}
                  onQueryChange={(q) => updateLine(idx, { productQuery: q })}
                  defaultCreateDraft={line.createDraft}
                  onCreateDraftChange={(d) => updateLine(idx, { createDraft: d })}
                />
              </div>
              {lines.length > 1 && (
                <button type="button" className="text-steel hover:text-red cursor-pointer p-1.5" onClick={() => removeLine(idx)} title="Quitar producto">
                  <X size={15} />
                </button>
              )}
            </div>

            {line.stats && line.stats.count > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-2.5">
                <div className="bg-cloud border border-rule rounded p-2 text-center">
                  <div className="text-[8.5px] uppercase text-steel">Más bajo</div>
                  <div className="text-[13px] font-bold text-green">${line.stats.min?.toFixed(2)}</div>
                </div>
                <div className="bg-cloud border border-rule rounded p-2 text-center">
                  <div className="text-[8.5px] uppercase text-steel">Promedio</div>
                  <div className="text-[13px] font-bold text-teal">${line.stats.avg?.toFixed(2)}</div>
                </div>
                <div className="bg-cloud border border-rule rounded p-2 text-center">
                  <div className="text-[8.5px] uppercase text-steel">Más alto</div>
                  <div className="text-[13px] font-bold text-red">${line.stats.max?.toFixed(2)}</div>
                </div>
              </div>
            )}
            {line.catalogItem && (!line.stats || line.stats.count === 0) && (
              <div className="text-[11px] text-steel mb-2.5">🆕 Sin historial previo — primera vez que se compra este producto, mercadería o insumo.</div>
            )}

            {/* Confirmado 2026-08-06: historial POR PROVEEDOR, más barato
                primero — para decidir a quién comprarle antes de elegir el
                proveedor de la solicitud (abajo), evitando pagar de más por
                olvido. El proveedor ya elegido para la solicitud se marca
                aparte si no es el más barato. */}
            {(supplierComparisons[idx]?.length ?? 0) > 0 && (
              <div className="bg-cloud border border-rule rounded-md p-2.5 mb-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1.5">Proveedores que ya vendieron esto — más barato primero</div>
                <div className="flex flex-col gap-1">
                  {supplierComparisons[idx]!.map((s, si) => {
                    const isChosen = supplier?.id === s.supplierId;
                    return (
                      <div key={s.supplierId} className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[11.5px] ${isChosen ? "bg-teal/10 border border-teal/30" : "bg-surface2"}`}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          {si === 0 && <span className="text-[9px] font-bold uppercase tracking-wide bg-green/15 text-green border border-green/40 rounded-full px-1.5 py-0.5 shrink-0">Más barato</span>}
                          <span className="truncate font-semibold">{s.supplierName}</span>
                          {isChosen && <span className="text-teal text-[9px] font-bold uppercase shrink-0">Elegido</span>}
                        </div>
                        <div className="text-steel shrink-0 font-mono">
                          últ. ${s.latest.toFixed(2)} · prom. ${s.avg.toFixed(2)} · máx. ${s.max.toFixed(2)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2.5 mb-2">
              <div>
                <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Cantidad</label>
                <input type="number" min="1" className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={line.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
              </div>
              <div>
                <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Costo/unidad</label>
                <input type="number" min="0" step="0.01" className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={line.unitCost} onChange={(e) => updateLine(idx, { unitCost: e.target.value })} />
              </div>
              <div>
                <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
                  Subtotal {line.ivaIncluded && <span className="text-teal normal-case">(con IVA)</span>}
                </label>
                <div className="rounded border border-rule px-2.5 py-2 text-[13px] font-bold bg-cloud">${lineTotals[idx].toFixed(2)}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[11.5px] text-steel">
              <input type="checkbox" className="w-auto cursor-pointer" checked={line.ivaIncluded} onChange={(e) => updateLine(idx, { ivaIncluded: e.target.checked })} />
              <span>El proveedor cobra 15% de IVA aparte de este costo <span className="text-steel-dim">— súmalo para que cuadre con la cotización</span></span>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="flex items-center gap-1.5 text-[12px] text-blue font-semibold cursor-pointer mb-3.5" onClick={addLine}>
        <Plus size={13} /> Agregar otro producto de esta misma cotización
      </button>

      <div className="mb-3.5">
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Proveedor</label>
        <PurchaseSupplierPicker
          type="SUPPLIER"
          value={supplier}
          onChange={(s) => { setSupplier(s); if (!s) setBankAccountId(null); }}
          label="Buscar o registrar proveedor"
          isAdmin={isAdmin}
          selectedBankAccountId={bankAccountId}
          onSelectBankAccount={setBankAccountId}
        />
      </div>

      {supplier && (
        <div className="mb-3.5 rounded-md border border-rule bg-cloud/40 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-steel">
              <Wallet size={13} /> Créditos pendientes con {supplier.name}
            </div>
            {!manualCreditOpen && (
              <button type="button" className="text-[11.5px] text-blue font-semibold cursor-pointer" onClick={() => setManualCreditOpen(true)}>
                + Agregar crédito manual
              </button>
            )}
          </div>

          {availableCredits.length > 0 ? (
            <div className="flex flex-col gap-1.5 mb-1">
              {availableCredits.map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-[12px] text-ink">
                  <input type="checkbox" className="w-auto cursor-pointer" checked={selectedCreditIds.includes(c.id)} onChange={() => toggleCredit(c.id)} />
                  <span className="font-semibold">${c.amount.toFixed(2)}</span>
                  <span className="text-steel">— {c.reason}</span>
                </div>
              ))}
            </div>
          ) : (
            !manualCreditOpen && <div className="text-[12px] text-steel">Sin créditos disponibles todavía con este proveedor.</div>
          )}

          {creditExceedsMsg && <div className="text-[11.5px] mt-1" style={{ color: "#D9A441" }}>{creditExceedsMsg}</div>}

          {selectedCreditIds.length > 0 && (
            <div className="text-[12px] mt-2 pt-2 border-t border-rule">
              <div className="text-green font-semibold">
                Crédito aplicado: ${availableCredits.filter((c) => selectedCreditIds.includes(c.id)).reduce((s, c) => s + c.amount, 0).toFixed(2)}
              </div>
              <div className="text-steel">
                Se solicitará pagar: ${Math.max(0, total - availableCredits.filter((c) => selectedCreditIds.includes(c.id)).reduce((s, c) => s + c.amount, 0)).toFixed(2)}
              </div>
            </div>
          )}

          {manualCreditOpen && (
            <div className="mt-2.5 pt-2.5 border-t border-rule flex flex-col gap-2">
              <input
                type="number"
                step="0.01"
                placeholder="Monto del crédito"
                className="text-[12.5px]"
                value={manualCreditAmount}
                onChange={(e) => setManualCreditAmount(e.target.value)}
              />
              <input
                type="text"
                placeholder="Motivo (ej. producto dañado que el proveedor acreditó)"
                className="text-[12.5px]"
                value={manualCreditReason}
                onChange={(e) => setManualCreditReason(e.target.value)}
              />
              {!manualCreditProofUrl ? (
                <div
                  tabIndex={0}
                  onPaste={onPasteManualCredit}
                  onMouseEnter={onManualCreditHoverIn}
                  onMouseLeave={onManualCreditHoverOut}
                  className="flex flex-col items-center justify-center gap-1 border-[1.5px] border-dashed border-rule rounded-md py-3 cursor-pointer hover:border-teal focus:border-teal focus:outline-none text-steel text-[12px]"
                >
                  <span className="flex items-center gap-2">
                    {uploadingManualCreditProof ? <span className="w-4 h-4 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={14} />}
                    Pega el comprobante aquí (Ctrl+V) — captura del chat o documento donde el proveedor acepta el crédito
                  </span>
                  <button type="button" className="text-[10.5px] underline decoration-dotted opacity-80 hover:opacity-100 cursor-pointer" onClick={() => manualCreditFileInputRef.current?.click()}>
                    o selecciona un archivo
                  </button>
                  <input ref={manualCreditFileInputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => e.target.files?.[0] && uploadManualCreditProof(e.target.files[0])} />
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[12px] text-teal">
                  <FileText size={13} /> {manualCreditProofName || "Comprobante adjunto"}
                  <button type="button" className="text-steel cursor-pointer" onClick={() => { setManualCreditProofUrl(null); setManualCreditProofName(null); }}>
                    <X size={13} />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={savingManualCredit}
                  className="text-[12px] font-semibold text-white bg-blue rounded-md px-3 py-1.5 cursor-pointer disabled:opacity-50"
                  onClick={saveManualCredit}
                >
                  {savingManualCredit ? "Guardando…" : "Guardar crédito"}
                </button>
                <button
                  type="button"
                  className="text-[12px] text-steel cursor-pointer"
                  onClick={() => { setManualCreditOpen(false); setManualCreditAmount(""); setManualCreditReason(""); setManualCreditProofUrl(null); setManualCreditProofName(null); }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mb-3.5">
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">
          Cotización <span className="text-steel-dim normal-case font-normal">— total de todos los productos: ${total.toFixed(2)}</span>
        </label>
        {!quoteImageUrl ? (
          <div
            tabIndex={0}
            onPaste={onPasteQuote}
            onMouseEnter={onPasteQuoteHoverIn}
            onMouseLeave={onPasteQuoteHoverOut}
            onDragOver={onDragOverQuote}
            onDragLeave={onDragLeaveQuote}
            onDrop={onDropQuote}
            className={`flex flex-col items-center justify-center gap-1 border-[1.5px] border-dashed rounded-md py-4 cursor-pointer focus:outline-none text-steel text-[12.5px] ${
              isDragOverQuote ? "border-teal bg-teal/5" : "border-rule hover:border-teal focus:border-teal"
            }`}
          >
            <span className="flex items-center gap-2">
              {uploadingQuote ? <span className="w-4 h-4 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={16} />}
              Pega o arrastra la cotización aquí (Ctrl+V)
            </span>
            <button type="button" className="text-[10.5px] underline decoration-dotted opacity-80 hover:opacity-100 cursor-pointer" onClick={() => quoteFileInputRef.current?.click()}>
              o selecciona un archivo
            </button>
            <input ref={quoteFileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleQuoteFile(e.target.files[0])} />
          </div>
        ) : (
          <div className="bg-cloud border border-rule rounded-md p-3">
            <div className="flex items-center gap-3 mb-2.5">
              <img src={quoteImageUrl} alt="" className="w-14 h-14 rounded object-cover border border-rule" />
              <div className="flex-1 text-[12.5px] text-steel">
                Escrito ({lines.length} {lines.length === 1 ? "producto" : "productos"}): <b className="text-ink">${total.toFixed(2)}</b>
              </div>
              {!verifyResult && (
                <button type="button" disabled={verifying || total <= 0} className="rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={verifyQuote}>
                  {verifying ? "Leyendo…" : "Verificar"}
                </button>
              )}
            </div>

            {verifyResult && (
              <>
                {verifyResult.matches ? (
                  <div className="flex items-center gap-2 text-[12.5px] text-teal">
                    <CheckCircle2 size={14} /> Coinciden — total leído ${verifyResult.readTotal?.toFixed(2)}
                  </div>
                ) : verifyResult.referenceCodeFound ? (
                  <div>
                    <div className="flex items-center gap-2 text-[12.5px] text-gold mb-2" style={{ color: "#D9A441" }}>
                      🔎 La cotización solo trae el código &quot;{verifyResult.referenceCodeFound}&quot;, sin nombre de producto.
                    </div>
                    {verifyResult.suggestedCatalogItem && (
                      <div className="text-[11.5px] text-steel mb-2">
                        Ese código ya está guardado como <b className="text-ink">{verifyResult.suggestedCatalogItem.name}</b> en el catálogo.
                      </div>
                    )}
                    {quoteCreditGap !== null && (
                      <div className="text-[11.5px] mb-2 rounded-md border p-2" style={{ borderColor: "#D9A441", color: "#D9A441", background: "rgba(217,164,65,0.08)" }}>
                        La cotización dice que el total a transferir es <b>${verifyResult.readTotal!.toFixed(2)}</b>, pero lo escrito es <b>${total.toFixed(2)}</b> — la diferencia (${quoteCreditGap.toFixed(2)}) ¿es un crédito pendiente con este proveedor?
                        <button
                          type="button"
                          className="block mt-1.5 text-[11.5px] font-semibold text-blue cursor-pointer"
                          onClick={() => {
                            setManualCreditAmount(quoteCreditGap.toFixed(2));
                            setManualCreditReason(`Cotización (código ${verifyResult.referenceCodeFound}) indicó $${verifyResult.readTotal!.toFixed(2)} a transferir — diferencia con lo escrito por crédito pendiente`);
                            setManualCreditProofUrl(quoteImageUrl);
                            setManualCreditProofName("Cotización");
                            setManualCreditOpen(true);
                          }}
                        >
                          Sí, registrar crédito por ${quoteCreditGap.toFixed(2)} — se agrega arriba, en &quot;Créditos pendientes&quot;
                        </button>
                      </div>
                    )}
                    {!manualCodeConfirm ? (
                      <button type="button" className="rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer" onClick={() => setManualCodeConfirm(true)}>
                        ✓ Sí, confirmo a qué producto(s) corresponde
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 text-[12.5px] text-teal"><CheckCircle2 size={14} /> Confirmado</div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[12.5px] text-red">
                    <Lock size={14} /> No coincide — la cotización dice ${verifyResult.readTotal?.toFixed(2) ?? "?"}, pero se escribió ${total.toFixed(2)}. Corrige el número o sube la imagen correcta.
                  </div>
                )}
              </>
            )}
            {!quoteVerified ? (
              <button type="button" className="text-[11px] text-steel mt-2 cursor-pointer" onClick={() => { setQuoteFile(null); setQuoteImageUrl(null); setVerifyResult(null); }}>
                Cambiar imagen
              </button>
            ) : !confirmUnlockQuote ? (
              <div className="flex items-center gap-2 mt-2">
                <span className="flex items-center gap-1 text-[11px] text-steel-dim"><Lock size={11} /> Verificada — anclada</span>
                <button type="button" className="text-[11px] text-steel underline cursor-pointer" onClick={() => setConfirmUnlockQuote(true)}>
                  Quitar verificación
                </button>
              </div>
            ) : (
              <div className="mt-2 border border-red/40 rounded-md bg-red/5 p-2.5">
                <div className="text-[11.5px] text-ink mb-2">¿Seguro? Se pierde esta imagen y su verificación — vas a tener que subir la cotización de nuevo y volver a verificarla con la IA.</div>
                <div className="flex gap-2">
                  <button type="button" className="text-[11px] text-steel border border-rule rounded px-2.5 py-1 cursor-pointer" onClick={() => setConfirmUnlockQuote(false)}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-white bg-red rounded px-2.5 py-1 cursor-pointer"
                    onClick={() => { setQuoteFile(null); setQuoteImageUrl(null); setVerifyResult(null); setManualCodeConfirm(false); setConfirmUnlockQuote(false); }}
                  >
                    Sí, quitar verificación
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mb-3.5">
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">
          Orden de compra{" "}
          {needsPurchaseOrder ? (
            <span className="text-red normal-case font-semibold">— obligatoria</span>
          ) : (
            <span className="text-steel-dim normal-case font-normal">(opcional — puedes subirla por adelantado)</span>
          )}
        </label>
        {needsPurchaseOrder && (
          <div className="text-[11.5px] text-red mb-2">
            La cotización solo trae un código, sin nombre de producto — sin eso, no hay respaldo de qué se está comprando ni de que el monto sea el correcto.
            Sube la orden de compra: la IA la va a leer y cruzar su monto contra lo que escribiste, para que cotización, lo tipeado y la orden de compra sean transparentes entre sí.
          </div>
        )}
        {!purchaseOrderUrl ? (
          <div>
            <div
              tabIndex={0}
              onPaste={onPastePurchaseOrder}
              onMouseEnter={onPastePOHoverIn}
              onMouseLeave={onPastePOHoverOut}
              onDragOver={onDragOverPO}
              onDragLeave={onDragLeavePO}
              onDrop={onDropPO}
              className={`flex flex-col items-center justify-center gap-1 border-[1.5px] border-dashed rounded-md py-3.5 cursor-pointer text-[12.5px] focus:outline-none ${
                isDragOverPO
                  ? "border-teal bg-teal/5 text-steel"
                  : needsPurchaseOrder
                  ? "border-red/45 text-red hover:border-red"
                  : "border-rule text-steel hover:border-teal focus:border-teal"
              }`}
            >
              <span className="flex items-center gap-2">
                {uploadingPurchaseOrder ? <span className="w-4 h-4 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={15} />}
                Pega o arrastra la orden de compra aquí (Ctrl+V)
              </span>
              <button type="button" className="text-[10.5px] underline decoration-dotted opacity-80 hover:opacity-100 cursor-pointer" onClick={() => purchaseOrderFileInputRef.current?.click()}>
                o selecciona una imagen
              </button>
              {/* Confirmado 2026-08-03: accept="image/*,application/pdf" hacía que el
                  celular mostrara el selector genérico de "Cámara y archivos" en vez
                  del acceso directo a la última foto — se separa el PDF como opción
                  aparte para que la foto (el caso más común) siga siendo un solo toque. */}
              <input ref={purchaseOrderFileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handlePurchaseOrderFile(e.target.files[0])} />
            </div>
            <label className="flex items-center justify-center gap-1.5 mt-1.5 text-[11px] text-steel cursor-pointer hover:text-teal">
              <FileText size={11} /> ¿Es un PDF? Subir documento
              <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && handlePurchaseOrderFile(e.target.files[0])} />
            </label>
          </div>
        ) : (
          <div className="bg-cloud border border-rule rounded-md p-3">
            <div className="flex items-center gap-3">
              {/\.pdf($|\?)/i.test(purchaseOrderUrl) ? (
                <FileText size={22} className="text-steel shrink-0" />
              ) : (
                <img src={purchaseOrderUrl} alt="" className="w-11 h-11 rounded object-cover border border-rule shrink-0" />
              )}
              <div className="flex-1 flex items-center gap-1.5 text-[12px] text-teal">
                <CheckCircle2 size={13} /> Orden de compra subida
              </div>
              {!poAnchored ? (
                <button type="button" className="text-[11px] text-steel cursor-pointer" onClick={() => { setPurchaseOrderFile(null); setPurchaseOrderUrl(null); setPoVerifyResult(null); setPoVerifyAttempts(0); }}>
                  Cambiar
                </button>
              ) : !confirmUnlockPO ? (
                <button type="button" className="flex items-center gap-1 text-[11px] text-steel underline cursor-pointer shrink-0" onClick={() => setConfirmUnlockPO(true)}>
                  <Lock size={11} /> Quitar verificación
                </button>
              ) : null}
            </div>
            {poAnchored && confirmUnlockPO && (
              <div className="mt-2.5 pt-2.5 border-t border-rule">
                <div className="border border-red/40 rounded-md bg-red/5 p-2.5">
                  <div className="text-[11.5px] text-ink mb-2">¿Seguro? Se pierde este documento y su verificación — vas a tener que subir la orden de compra de nuevo y volver a verificarla con la IA.</div>
                  <div className="flex gap-2">
                    <button type="button" className="text-[11px] text-steel border border-rule rounded px-2.5 py-1 cursor-pointer" onClick={() => setConfirmUnlockPO(false)}>
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-white bg-red rounded px-2.5 py-1 cursor-pointer"
                      onClick={() => { setPurchaseOrderFile(null); setPurchaseOrderUrl(null); setPoVerifyResult(null); setConfirmUnlockPO(false); }}
                    >
                      Sí, quitar verificación
                    </button>
                  </div>
                </div>
              </div>
            )}
            {needsPurchaseOrder && (
              <div className="mt-2.5 pt-2.5 border-t border-rule">
                {poVerifying ? (
                  <div className="flex items-center gap-2 text-[12px] text-steel">
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> Leyendo el monto de la orden de compra…
                  </div>
                ) : poVerifyResult?.matches ? (
                  <div className="flex items-center gap-2 text-[12px] text-teal">
                    <CheckCircle2 size={14} /> Coincide — la orden de compra dice ${poVerifyResult.readTotal?.toFixed(2)}, igual que la cotización y lo escrito.
                  </div>
                ) : poVerifyResult ? (
                  <div className="flex items-center gap-2 text-[12px] text-red">
                    <Lock size={14} /> No coincide — la orden de compra dice ${poVerifyResult.readTotal?.toFixed(2) ?? "?"}, pero se escribió ${total.toFixed(2)}. Corrige el número o sube la orden de compra correcta.
                  </div>
                ) : poVerifyAttempts >= 3 ? (
                  <div className="flex items-center gap-2 text-[12px] text-red">
                    <AlertTriangle size={14} /> No se pudo leer el monto de la orden de compra después de varios intentos. Sube una foto más clara.
                  </div>
                ) : poVerifyAttempts > 0 ? (
                  <div className="flex items-center gap-2 text-[12px] text-steel">
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> No se pudo leer a la primera — reintentando…
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mb-3.5 text-[12.5px] text-steel">
        <input type="checkbox" checked={shippingIncluded} onChange={(e) => setShippingIncluded(e.target.checked)} className="w-auto cursor-pointer" />
        El costo del producto SÍ incluye el envío <span className="text-steel-dim">— márcalo solo si confirmas que el proveedor NO cobra el flete por separado</span>
      </div>

      {!shippingIncluded && (
        <div className="bg-surface2 border border-rule rounded-md p-3.5 mb-3.5">
          <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Transportista</label>

          <div className="flex items-center gap-2 mb-3 text-[12px] text-steel">
            <input
              type="checkbox"
              checked={shippingCarrierPending}
              onChange={(e) => { setShippingCarrierPending(e.target.checked); if (e.target.checked) { setCarrier(null); setCarrierBankAccountId(null); setShippingCostTotal(""); } }}
              className="w-auto cursor-pointer"
            />
            Todavía no sé el transportista ni el costo del flete — lo completo después
          </div>

          {shippingCarrierPending ? (
            <div className="text-[11.5px] text-steel bg-cloud border border-dashed border-rule rounded-md p-3">
              Va a quedar pendiente en &quot;Mis solicitudes&quot; hasta que completes el transportista y el costo real — el pago del flete se hace cuando llegue la mercadería.
            </div>
          ) : (
            <>
              <PurchaseSupplierPicker
                type="CARRIER"
                value={carrier}
                onChange={(c) => { setCarrier(c); if (!c) setCarrierBankAccountId(null); }}
                label="Buscar o registrar transportista"
                isAdmin={isAdmin}
                selectedBankAccountId={carrierBankAccountId}
                onSelectBankAccount={setCarrierBankAccountId}
              />
              {carrier && (carrier.bankAccounts ?? []).length === 0 && (
                <div className="text-[10.5px] text-steel mt-1.5">
                  Todavía sin cuenta bancaria registrada — normal si el transportista solo la da al entregar. Se puede agregar después.
                </div>
              )}
              <div className="grid grid-cols-2 gap-2.5 mt-3">
                <div>
                  <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Costo de envío (total)</label>
                  <input type="number" min="0" step="0.01" className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]" value={shippingCostTotal} onChange={(e) => setShippingCostTotal(e.target.value)} />
                </div>
                <div>
                  <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">¿Cómo se paga?</label>
                  <select className="w-full rounded border border-rule bg-surface px-2.5 py-2 text-[13.5px]" value={shippingPaymentMethod} onChange={(e) => setShippingPaymentMethod(e.target.value as "TRANSFER" | "PETTY_CASH")}>
                    <option value="TRANSFER">Transferencia bancaria</option>
                    <option value="PETTY_CASH">Efectivo — caja chica</option>
                  </select>
                </div>
              </div>
              {lines.length > 1 && (
                <div className="text-[10.5px] text-steel mt-2">El costo de envío se reparte entre los productos según la cantidad de cada uno.</div>
              )}
              <div className="mt-3">
                <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">¿Cuándo se paga el flete?</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={`flex-1 rounded-md border py-1.5 text-[12px] font-semibold cursor-pointer ${shippingPaymentTiming === "WITH_PURCHASE" ? "border-teal bg-teal/10 text-teal" : "border-rule text-steel"}`}
                    onClick={() => setShippingPaymentTiming("WITH_PURCHASE")}
                  >
                    Junto con la compra
                  </button>
                  <button
                    type="button"
                    className={`flex-1 rounded-md border py-1.5 text-[12px] font-semibold cursor-pointer ${shippingPaymentTiming === "ON_DELIVERY" ? "border-teal bg-teal/10 text-teal" : "border-rule text-steel"}`}
                    onClick={() => setShippingPaymentTiming("ON_DELIVERY")}
                  >
                    Cuando llegue la mercadería
                  </button>
                </div>
                {shippingPaymentTiming === "ON_DELIVERY" && (
                  <div className="text-[10.5px] text-steel mt-1.5">
                    En cuanto esté aprobada vas a poder pedir con un clic que se pague el flete — no hace falta esperar a que Inventario confirme que llegó. Eso sí, apenas se pague, Inventario recibe aviso para revisar esa mercadería.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {needsJustification && (
        <div className="bg-red/10 border-[1.5px] border-red/45 rounded-md p-3.5 mb-3.5">
          <div className="flex items-center gap-1.5 text-[13px] font-bold text-red mb-1">
            <AlertTriangle size={14} /> {overThreshold && supplierNotCheapest ? "Precio sobre el historial y hay un proveedor más barato" : overThreshold ? "Precio por encima del historial" : "Hay un proveedor más barato"}
          </div>
          <div className="text-[12px] text-steel mb-2.5">
            {overThresholdLines.map((l) => (
              <div key={`over-${l.idx}`}>
                <b className="text-ink">{l.name}</b>: ${l.effCost.toFixed(2)} por unidad, supera el promedio de ${l.last3Avg.toFixed(2)}.
              </div>
            ))}
            {supplierNotCheapestLines.map((l) => (
              <div key={`supplier-${l.idx}`}>
                <b className="text-ink">{l.name}</b>: {l.cheapestSupplierName} lo vendió más barato (${l.cheapestPrice.toFixed(2)}/un.) que el proveedor elegido.
              </div>
            ))}
            No se puede enviar sin explicar por qué.
          </div>
          <textarea
            className="w-full rounded border border-red/40 bg-surface2 px-2.5 py-2 text-[12.5px] resize-vertical min-h-[60px]"
            placeholder="Ej. El proveedor más barato ya no tiene stock esta semana…"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
          />
        </div>
      )}

      {toast && <div className="text-teal text-[12.5px] mb-3">{toast}</div>}
      {err && <div className="text-red text-[12.5px] mb-3">{err}</div>}
      <button type="button" disabled={busy} className="rounded border border-teal bg-teal px-4 py-2 text-[13px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={submit}>
        {busy ? "Enviando…" : "Enviar y confirmar"}
      </button>
    </div>
  );
}
