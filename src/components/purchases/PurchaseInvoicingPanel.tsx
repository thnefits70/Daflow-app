"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, CheckCircle2, Truck, Lock, Wallet, Search, AlertTriangle, Landmark } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";
import { actorName } from "@/lib/actorName";
import { formatDateTime } from "@/lib/formatDateTime";
import { PurchaseOperationDocuments, type OperationDocRow } from "./PurchaseOperationDocuments";
import { CatalogCode } from "@/components/shared/CatalogCode";

type InvoiceStatus = "PENDING" | "COMPLETE" | "PARTIAL" | "NON_FISCAL" | "NONE";

type Row = {
  id: string;
  groupId: string;
  requestNumber: number | null;
  status: "APPROVED" | "PAID" | "RECEIVED_PENDING_REVIEW" | "RECEIVED";
  quantity: number;
  totalCost: number;
  invoiceStatus: InvoiceStatus;
  invoiceAmount: number | null;
  invoiceDocUrl: string | null;
  invoicedBy: { name: string } | null;
  invoicedAt: string | null;
  reviewedAt: string | null;
  paidAt: string | null;
  paidBy: { name: string } | null;
  requestedBy: { name: string } | null;
  catalogItem: { name: string; photos: string[]; justCode: string | null };
  supplier: { id: string; name: string };
  bankAccount: {
    bankName: string;
    bankAccountType: string;
    bankAccountNumber: string;
    bankAccountHolder: string;
    holderIdType: string | null;
    holderIdNumber: string | null;
  } | null;
  shippingIncluded: boolean;
  shippingPaymentTiming: "WITH_PURCHASE" | "ON_DELIVERY" | null;
  shippingPaymentMethod: "TRANSFER" | "PETTY_CASH" | null;
  shippingCostTotal: number | null;
  carrier: { name: string } | null;
  carrierBankAccount: {
    bankName: string;
    bankAccountType: string;
    bankAccountNumber: string;
    bankAccountHolder: string;
    holderIdType: string | null;
    holderIdNumber: string | null;
  } | null;
  shippingPaymentRequestedAt: string | null;
  shippingPaymentRequestedBy: { name: string } | null;
  shippingPaidAt: string | null;
  shippingPaidBy: { name: string } | null;
  quoteImageUrl: string;
  purchaseOrderUrl: string | null;
  paymentProofUrl: string | null;
  shippingPaymentProofUrl: string | null;
  receipt: {
    photoUrls: string[];
    receivedQuantity: number;
    aiPhotoMatch: boolean | null;
    aiPhotoNote: string | null;
    confirmedBy: { name: string } | null;
  } | null;
  financeFlagNote: string | null;
  financeFlaggedAt: string | null;
  financeFlaggedBy: { name: string } | null;
};

type UrgentReportSummary = {
  requestId: string;
  damagedQty: number;
  missingQty: number;
  incompleteQty: number;
  differentQty: number;
  resolutions: { quantity: number; status: "PENDING" | "COMPLETED" | "CANCELLED" }[];
};

function toDocRow(r: Row): OperationDocRow {
  return {
    id: r.id,
    catalogItem: r.catalogItem,
    quoteImageUrl: r.quoteImageUrl,
    purchaseOrderUrl: r.purchaseOrderUrl,
    paymentProofUrl: r.paymentProofUrl,
    shippingPaymentProofUrl: r.shippingPaymentProofUrl,
    invoiceDocUrl: r.invoiceDocUrl,
    requestedBy: r.requestedBy,
    paidBy: r.paidBy,
    invoicedBy: r.invoicedBy,
    receipt: r.receipt,
  };
}

const INVOICE_LABELS: Record<InvoiceStatus, string> = {
  PENDING: "Pendiente de revisar",
  COMPLETE: "Factura completa (por el total pagado)",
  PARTIAL: "Factura parcial (por una parte)",
  NON_FISCAL: "Comprobante de compra (no es factura fiscal)",
  NONE: "No entregaron ningún documento",
};

function money(n: number) {
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;
}

// Confirmado 2026-09-03: pedido explícito del usuario — visibilidad de
// cuánto tiempo lleva algo sin gestionarse, para que cada quien vea de un
// vistazo qué tan atrasado está lo que le corresponde.
function elapsedHours(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}
function elapsedLabel(iso: string): string {
  const totalMinutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

// Confirmado 2026-08-11: mismo código único (SC-XXX) ya visible en Mis
// solicitudes/Auditoría — pedido explícito del usuario para poder buscar
// una operación por código, igual que ya se puede filtrar por fecha.
function formatPurchaseRequestCode(requestNumber: number | null): string {
  return requestNumber ? `SC-${String(requestNumber).padStart(3, "0")}` : "—";
}

function isImageUrl(url: string) {
  return /\.(jpe?g|png|gif|webp|heic)$/i.test(url);
}

function groupRows(rows: Row[]) {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    if (!map.has(r.groupId)) map.set(r.groupId, []);
    map.get(r.groupId)!.push(r);
  }
  return [...map.values()];
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
// Confirmado 2026-08-06: últimos 12 meses para el selector de "Filtrar por
// mes" — mismo criterio ya usado en otras plantillas de meses de la app.
function recentMonths(): string[] {
  const now = new Date();
  const months: string[] = [];
  for (let i = 0; i <= 11; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }
  return months;
}
function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${pad2(lastDay)}` };
}
const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function monthFilterLabel(month: string) {
  const [y, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

// Confirmado 2026-08-24: fix de un bug real reportado por el usuario —
// admin veía esta pantalla totalmente editable (Guardar, marcar como
// pagado, subir factura, etc.) aunque registrar factura es exclusivo de
// Nairoby (líder de Finanzas). Mismo patrón que canApprove en
// PurchaseReceivingPanel: admin sigue viendo todo (isAdmin=false por
// defecto solo cuando de verdad es Nairoby), pero cada botón que muta algo
// queda disabled con un tooltip cuando isAdmin=true.
const ADMIN_LOCK_TITLE = "Exclusivo de Nairoby (líder de Finanzas)";

// Fix confirmado 2026-08-25: pedido explícito del usuario — admin sí
// transfiere la plata de mercadería (Bryan solo solicita), así que pagar
// esa parte ya no debe quedar bloqueado para admin, a diferencia de
// registrar factura, pagar flete y marcar para revisar, que siguen
// exclusivos de Nairoby. Por defecto sigue igual que antes (bloqueado
// cuando isAdmin) para no romper algún caller que no pase el prop nuevo.
export function PurchaseInvoicingPanel({ isAdmin = false, canPayMerchandise }: { isAdmin?: boolean; canPayMerchandise?: boolean }) {
  const canPay = canPayMerchandise ?? !isAdmin;
  const payLocked = !canPay;
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pettyCash, setPettyCash] = useState<{ count: number; total: number } | null>(null);
  const [payingGroup, setPayingGroup] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [proofVerifying, setProofVerifying] = useState(false);
  const [proofVerifyResult, setProofVerifyResult] = useState<{ readAmount: number | null; matches: boolean; receiptNumber: string | null } | null>(null);
  const [availableCredits, setAvailableCredits] = useState<{ id: string; amount: number; reason: string }[]>([]);
  const [selectedCreditIds, setSelectedCreditIds] = useState<string[]>([]);
  // Confirmado 2026-08-12: crédito que ya quedó reservado para esta solicitud
  // desde que Bryan la pidió (ver reserveCreditsForGroup) — se ve como ya
  // aplicado, sin checkbox, separado del crédito adicional que sí se elige acá.
  const [reservedCredits, setReservedCredits] = useState<{ id: string; amount: number; reason: string }[]>([]);
  // Confirmado 2026-08-06: filtro de fechas para "Registrar factura" — sin
  // esto la lista crece para siempre con todo el historial. dateFrom/dateTo
  // vacíos = sin filtro (se ve todo). El selector de mes y "Mes anterior"
  // solo son atajos que rellenan estos dos campos.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [query, setQuery] = useState("");
  const [urgentReports, setUrgentReports] = useState<UrgentReportSummary[]>([]);
  const [flagOpenGroupId, setFlagOpenGroupId] = useState<string | null>(null);
  const [flagNote, setFlagNote] = useState("");
  const { onPaste: onPasteProof, onMouseEnter: onPasteProofHoverIn, onMouseLeave: onPasteProofHoverOut } = usePasteFile((file) => uploadProof(file));
  const proofFileInputRef = useRef<HTMLInputElement>(null);
  // El grupo de la factura que se está pasando el mouse encima ahora mismo
  // — un solo listener de paste "armado" por hover, compartido entre todas
  // las tarjetas de la lista, en vez de un hook por cada una.
  const invoiceDocGroupRef = useRef<string | null>(null);
  const { onPaste: onPasteInvoiceDoc, onMouseEnter: armInvoiceDocPaste, onMouseLeave: disarmInvoiceDocPaste } = usePasteFile((file) => {
    const groupId = invoiceDocGroupRef.current;
    if (groupId) uploadInvoiceDoc(groupId, file);
  });
  const [partialAmounts, setPartialAmounts] = useState<Record<string, string>>({});
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const [err, setErr] = useState("");

  // Confirmado 2026-08-21: "volver a subir factura" es para CORREGIR el
  // documento de una factura que ya quedó registrada — a propósito separado
  // del flujo de arriba (que registra por primera vez). Como reemplaza algo
  // que ya se dio por bueno, exige confirmar dos veces en el mismo botón en
  // vez de guardar apenas se sube el archivo, para que no se reemplace por
  // accidente al pegar/seleccionar la foto equivocada.
  const [reuploadOpenGroupId, setReuploadOpenGroupId] = useState<string | null>(null);
  const [replaceDocUrl, setReplaceDocUrl] = useState<Record<string, string>>({});
  const [uploadingReplaceDoc, setUploadingReplaceDoc] = useState<string | null>(null);
  const [replaceConfirming, setReplaceConfirming] = useState<Record<string, boolean>>({});
  const [replacingDoc, setReplacingDoc] = useState<string | null>(null);

  const [payingShippingGroup, setPayingShippingGroup] = useState<string | null>(null);
  const [shippingProofUrl, setShippingProofUrl] = useState<string | null>(null);
  const [uploadingShippingProof, setUploadingShippingProof] = useState(false);
  const [shippingProofVerifying, setShippingProofVerifying] = useState(false);
  const [shippingProofVerifyResult, setShippingProofVerifyResult] = useState<{ readAmount: number | null; matches: boolean; receiptNumber: string | null } | null>(null);
  const { onPaste: onPasteShippingProof, onMouseEnter: onPasteShippingProofHoverIn, onMouseLeave: onPasteShippingProofHoverOut } = usePasteFile((file) => uploadShippingProof(file));
  const shippingProofFileInputRef = useRef<HTMLInputElement>(null);

  // Confirmado 2026-07-31: por defecto se asume que SÍ hay factura (pide
  // completa/parcial + documento opcional) — "No hay factura" es la
  // excepción que se elige a propósito, con dos botones de un solo clic
  // (comprobante no fiscal / no entregaron nada) que finalizan al toque.
  const [choice, setChoice] = useState<Record<string, "YES" | "NO">>({});
  const [invoiceType, setInvoiceType] = useState<Record<string, "COMPLETE" | "PARTIAL">>({});
  const [invoiceDocUrl, setInvoiceDocUrl] = useState<Record<string, string>>({});
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  // Confirmado 2026-09-03: pedido explícito del usuario — saldo de crédito
  // por proveedor, mostrado de una vez en la tarjeta de "falta pagar" (sin
  // tener que abrir "Subir comprobante" para enterarse).
  const [supplierCredits, setSupplierCredits] = useState<Record<string, number>>({});

  function load() {
    fetch("/api/purchase-requests?view=invoicing").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
    fetch("/api/purchase-requests/petty-cash-summary").then((r) => (r.ok ? r.json() : null)).then(setPettyCash).catch(() => null);
    fetch("/api/purchase-requests/urgent-reports").then((r) => (r.ok ? r.json() : [])).then(setUrgentReports).catch(() => setUrgentReports([]));
  }
  useEffect(load, []);

  useEffect(() => {
    if (!rows) return;
    const supplierIds = [...new Set(rows.filter((r) => r.status === "APPROVED").map((r) => r.supplier.id))];
    if (supplierIds.length === 0) return;
    Promise.all(
      supplierIds.map((id) =>
        fetch(`/api/purchase-suppliers/${id}/credit-balance`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => [id, data?.balance ?? 0] as const)
          .catch(() => [id, 0] as const)
      )
    ).then((entries) => setSupplierCredits(Object.fromEntries(entries)));
  }, [rows]);

  // Confirmado 2026-08-06: mientras la suma de resoluciones COMPLETED no
  // cubra el total reportado, la operación sigue "con algo pendiente con el
  // proveedor" — no bloquea que Nairoby registre factura, solo se lo avisa.
  function openReportsForGroup(groupId: string) {
    const requestIds = new Set((rows ?? []).filter((r) => r.groupId === groupId).map((r) => r.id));
    return urgentReports.filter((rep) => {
      if (!requestIds.has(rep.requestId)) return false;
      const total = rep.damagedQty + rep.missingQty + rep.incompleteQty + rep.differentQty;
      const completed = rep.resolutions.filter((res) => res.status === "COMPLETED").reduce((s, res) => s + res.quantity, 0);
      return completed < total;
    });
  }

  async function saveFinanceFlag(groupId: string, note: string | null) {
    setBusyGroup(groupId);
    await fetch(`/api/purchase-requests/group/${groupId}/finance-flag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    setBusyGroup(null);
    setFlagOpenGroupId(null);
    load();
    router.refresh();
  }

  function currentGroupRows(groupId: string) {
    return (rows ?? []).filter((r) => r.groupId === groupId);
  }

  function netAmountFor(groupId: string) {
    const total = currentGroupRows(groupId).reduce((s, r) => s + r.totalCost, 0);
    const reservedTotal = reservedCredits.reduce((s, c) => s + c.amount, 0);
    const appliedTotal = availableCredits.filter((c) => selectedCreditIds.includes(c.id)).reduce((s, c) => s + c.amount, 0);
    return Math.max(0, total - reservedTotal - appliedTotal);
  }

  // Confirmado 2026-08-06: al abrir "Marcar como pagado" se consulta si el
  // proveedor tiene crédito disponible (por mercadería dañada/incompleta de
  // una compra anterior) — se puede aplicar aquí para pagar solo la
  // diferencia, en vez de perderlo o tener que recordarlo a mano. Confirmado
  // 2026-08-12: también se consulta el crédito YA reservado para esta
  // solicitud desde que se pidió, para restarlo del neto sin volver a elegirlo.
  async function openPay(groupId: string, supplierId: string) {
    setPayingGroup(groupId);
    setProofUrl(null);
    setProofVerifyResult(null);
    setSelectedCreditIds([]);
    setReservedCredits([]);
    setErr("");
    const res = await fetch(`/api/purchase-suppliers/${supplierId}/credit-balance?groupId=${groupId}`);
    const data = await res.json().catch(() => null);
    setAvailableCredits(res.ok ? data.credits : []);
    setReservedCredits(res.ok ? data.reserved ?? [] : []);
  }

  function toggleCredit(id: string) {
    setSelectedCreditIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    setProofVerifyResult(null);
  }

  // Confirmado 2026-08-04: la misma verificación por IA del comprobante que
  // ya corre en la Bandeja de aprobación aplica aquí también — no importa
  // desde qué pantalla se suba el comprobante (mercadería o flete), siempre
  // se compara contra lo que de verdad correspondía pagar antes de dejarlo
  // avanzar. Si se aplicó crédito, se compara contra el NETO, no el total.
  async function verifyProof(groupId: string, url: string) {
    setProofVerifying(true);
    setProofVerifyResult(null);
    const expectedAmount = netAmountFor(groupId);
    const res = await fetch("/api/purchase-requests/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proofUrl: url, expectedAmount }),
    });
    setProofVerifying(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo verificar el comprobante.");
      return;
    }
    setProofVerifyResult(data);
  }

  async function verifyShippingProof(groupId: string, url: string) {
    setShippingProofVerifying(true);
    setShippingProofVerifyResult(null);
    const expectedAmount = currentGroupRows(groupId)[0]?.shippingCostTotal ?? 0;
    const res = await fetch("/api/purchase-requests/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proofUrl: url, expectedAmount }),
    });
    setShippingProofVerifying(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo verificar el comprobante del flete.");
      return;
    }
    setShippingProofVerifyResult(data);
  }

  async function pay(groupId: string) {
    const netAmount = netAmountFor(groupId);
    if (netAmount > 0) {
      if (!proofUrl) {
        setErr("Sube el comprobante de pago.");
        return;
      }
      if (!proofVerifyResult?.matches) {
        setErr("El comprobante todavía no está verificado — el monto debe coincidir con lo que corresponde pagar.");
        return;
      }
    }
    setBusyGroup(groupId);
    setErr("");
    const res = await fetch(`/api/purchase-requests/group/${groupId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentProofUrl: proofUrl ?? undefined, paymentProofReceiptNumber: proofVerifyResult?.receiptNumber ?? null, appliedCreditIds: selectedCreditIds }),
    });
    setBusyGroup(null);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo registrar el pago.");
      return;
    }
    setPayingGroup(null);
    setProofUrl(null);
    setProofVerifyResult(null);
    setSelectedCreditIds([]);
    setReservedCredits([]);
    load();
    router.refresh();
  }

  async function setInvoice(groupId: string, invoiceStatus: InvoiceStatus, opts?: { invoiceAmount?: number; invoiceDocUrl?: string }) {
    setBusyGroup(groupId);
    await fetch(`/api/purchase-requests/group/${groupId}/invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceStatus, invoiceAmount: opts?.invoiceAmount, invoiceDocUrl: opts?.invoiceDocUrl }),
    });
    setBusyGroup(null);
    load();
  }

  function finalizeYes(groupId: string) {
    const type = invoiceType[groupId] ?? "COMPLETE";
    if (type === "PARTIAL" && !partialAmounts[groupId]) return;
    setInvoice(groupId, type, {
      invoiceAmount: type === "PARTIAL" ? Number(partialAmounts[groupId]) : undefined,
      invoiceDocUrl: invoiceDocUrl[groupId],
    });
  }

  async function uploadProof(file: File) {
    if (!payingGroup) return;
    setErr("");
    setUploadingProof(true);
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-payments");
    setUploadingProof(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setProofUrl(uploaded.url);
    verifyProof(payingGroup, uploaded.url);
  }

  async function uploadShippingProof(file: File) {
    if (!payingShippingGroup) return;
    setErr("");
    setUploadingShippingProof(true);
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-payments");
    setUploadingShippingProof(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setShippingProofUrl(uploaded.url);
    verifyShippingProof(payingShippingGroup, uploaded.url);
  }

  async function payShipping(groupId: string) {
    if (shippingProofUrl && !shippingProofVerifyResult?.matches) {
      setErr("El comprobante del flete todavía no está verificado — el monto debe coincidir con lo que corresponde pagar.");
      return;
    }
    setBusyGroup(groupId);
    setErr("");
    const res = await fetch(`/api/purchase-requests/group/${groupId}/shipping-pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proofUrl: shippingProofUrl, proofReceiptNumber: shippingProofVerifyResult?.receiptNumber ?? null }),
    });
    setBusyGroup(null);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo registrar el pago del flete.");
      return;
    }
    setPayingShippingGroup(null);
    setShippingProofUrl(null);
    setShippingProofVerifyResult(null);
    load();
  }

  async function uploadInvoiceDoc(groupId: string, file: File) {
    setErr("");
    setUploadingDoc(groupId);
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-invoices");
    setUploadingDoc(null);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setInvoiceDocUrl((m) => ({ ...m, [groupId]: uploaded.url }));
  }

  function openReupload(groupId: string) {
    setReuploadOpenGroupId(groupId);
    setReplaceDocUrl((m) => { const next = { ...m }; delete next[groupId]; return next; });
    setReplaceConfirming((m) => ({ ...m, [groupId]: false }));
    setErr("");
  }

  function cancelReupload(groupId: string) {
    setReuploadOpenGroupId(null);
    setReplaceDocUrl((m) => { const next = { ...m }; delete next[groupId]; return next; });
    setReplaceConfirming((m) => ({ ...m, [groupId]: false }));
  }

  async function uploadReplaceDoc(groupId: string, file: File) {
    setErr("");
    setUploadingReplaceDoc(groupId);
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-invoices");
    setUploadingReplaceDoc(null);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setReplaceDocUrl((m) => ({ ...m, [groupId]: uploaded.url }));
    setReplaceConfirming((m) => ({ ...m, [groupId]: false }));
  }

  async function confirmReplaceDoc(groupId: string) {
    // Primer clic: solo pide la confirmación final, no guarda nada todavía.
    if (!replaceConfirming[groupId]) {
      setReplaceConfirming((m) => ({ ...m, [groupId]: true }));
      return;
    }
    const url = replaceDocUrl[groupId];
    if (!url) return;
    setReplacingDoc(groupId);
    setErr("");
    const res = await fetch(`/api/purchase-requests/group/${groupId}/invoice-doc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceDocUrl: url }),
    });
    setReplacingDoc(null);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo reemplazar el documento.");
      return;
    }
    cancelReupload(groupId);
    load();
  }

  if (!rows) return <div className="text-steel text-[13px]">Cargando…</div>;

  const approvedGroups = groupRows(rows.filter((r) => r.status === "APPROVED"));
  // Confirmado 2026-08-12: pedido explícito del usuario (Opción A) — una
  // operación desaparece de "Registrar factura" solo cuando las DOS partes
  // ya cerraron: Nairoby ya declaró la factura (invoiceStatus !== PENDING)
  // Y Daniel ya confirmó que llegó TODO lo de esa cotización (cada fila en
  // RECEIVED) — a propósito, para que Nairoby no pueda dar por cerrada una
  // operación mientras la mercadería todavía no llegó de verdad y se pueda
  // perder ese dinero. Mientras falte cualquiera de las dos, sigue aquí;
  // una vez cierran ambas, solo queda visible en Auditoría.
  const restGroupsAll = groupRows(rows.filter((r) => r.status !== "APPROVED")).filter(
    (g) => !(g[0].invoiceStatus !== "PENDING" && g.every((r) => r.status === "RECEIVED"))
  );
  // Confirmado 2026-08-06: por fecha de pago (paidAt) — es lo que ya se ve
  // impreso en cada tarjeta ("Pagado ... · fecha"), así el filtro coincide
  // con lo que la persona está mirando.
  const q = query.trim().toLowerCase();
  const restGroups = (dateFrom || dateTo || q)
    ? restGroupsAll.filter((g) => {
        const d = g[0].paidAt?.slice(0, 10);
        if ((dateFrom || dateTo) && d) {
          if (dateFrom && d < dateFrom) return false;
          if (dateTo && d > dateTo) return false;
        }
        if (!q) return true;
        return (
          g.some((r) => r.catalogItem.name.toLowerCase().includes(q)) ||
          g.some((r) => r.catalogItem.justCode?.toLowerCase().includes(q)) ||
          g[0].supplier.name.toLowerCase().includes(q) ||
          formatPurchaseRequestCode(g[0].requestNumber).toLowerCase().includes(q)
        );
      })
    : restGroupsAll;

  function applyMonthFilter(month: string) {
    setMonthFilter(month);
    if (!month) { setDateFrom(""); setDateTo(""); return; }
    const { from, to } = monthBounds(month);
    setDateFrom(from);
    setDateTo(to);
  }
  function applyPrevMonth() {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const month = `${prev.getFullYear()}-${pad2(prev.getMonth() + 1)}`;
    applyMonthFilter(month);
  }
  function clearDateFilter() {
    setMonthFilter("");
    setDateFrom("");
    setDateTo("");
  }
  // Confirmado 2026-08-03: solo aparece acá una vez que quien solicitó pidió
  // el pago con un clic (antes de eso no hay nada que Finanzas deba hacer).
  const pendingShippingGroups = groupRows(
    rows.filter((r) => !r.shippingIncluded && r.shippingPaymentTiming === "ON_DELIVERY" && r.shippingPaymentRequestedAt && !r.shippingPaidAt && r.shippingPaymentMethod !== "PETTY_CASH")
  );

  return (
    <div>
      {isAdmin && (
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">
          <Lock size={13} />
          {canPay
            ? "Puedes pagar mercadería tú mismo. Registrar factura, pagar flete y marcar para revisar sigue siendo exclusivo de Nairoby (líder de Finanzas)"
            : "Vista de solo lectura — registrar factura y marcar pagos es exclusivo de Nairoby (líder de Finanzas)"}
        </div>
      )}
      {pettyCash && pettyCash.count > 0 && (
        <div className="bg-surface border border-rule rounded-md p-4 mb-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2.5">
            Resumen del mes — fletes pagados con caja chica
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-cloud rounded p-2.5 text-center">
              <div className="text-[9px] uppercase text-steel">Pagos en efectivo</div>
              <div className="text-[16px] font-bold">{pettyCash.count}</div>
            </div>
            <div className="bg-cloud rounded p-2.5 text-center">
              <div className="text-[9px] uppercase text-steel">Total del mes</div>
              <div className="text-[16px] font-bold text-teal">{money(pettyCash.total)}</div>
            </div>
          </div>
        </div>
      )}

      {approvedGroups.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Aprobadas — falta pagar</div>
          <div className="flex flex-col gap-2.5">
            {approvedGroups.map((g) => {
              const groupId = g[0].groupId;
              const total = g.reduce((s, r) => s + r.totalCost, 0);
              return (
                <div key={groupId} className="bg-surface border border-rule rounded-md p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      {g.map((r) => (
                        <div key={r.id} className="text-[13.5px] font-bold flex items-center gap-1.5 flex-wrap">
                          <CatalogCode code={r.catalogItem.justCode} />
                          <span>{r.catalogItem.name} · {r.quantity} un.</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-col items-end shrink-0 gap-0.5">
                      <span className="font-display text-[16px] font-bold text-teal leading-tight">{money(total)}</span>
                      <span className="font-mono text-[10.5px] text-steel">{formatPurchaseRequestCode(g[0].requestNumber)}</span>
                      {supplierCredits[g[0].supplier.id] !== undefined && (
                        <span className={`text-[9.5px] font-semibold text-right leading-tight ${supplierCredits[g[0].supplier.id] > 0 ? "text-red" : "text-teal"}`}>
                          {supplierCredits[g[0].supplier.id] > 0
                            ? `Crédito con ${g[0].supplier.name}: ${money(supplierCredits[g[0].supplier.id])}`
                            : "Sin créditos pendientes"}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-[11.5px] text-steel">{g[0].supplier.name}</div>
                  <div className="text-[10px] text-steel-dim mb-2.5">
                    Solicitada por {actorName(g[0].requestedBy?.name)}
                    {g[0].reviewedAt && (
                      <>
                        {" "}· Aprobada {formatDateTime(g[0].reviewedAt)} ·{" "}
                        <span className={elapsedHours(g[0].reviewedAt) >= 24 ? "font-semibold text-red" : ""}>
                          lleva {elapsedLabel(g[0].reviewedAt)} sin gestionar
                        </span>
                      </>
                    )}
                  </div>
                  <div className="bg-cloud border border-rule rounded-md px-3 py-2.5 mb-2.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel mb-1.5">
                      <Landmark size={12} /> Transferir a {g[0].supplier.name}
                    </div>
                    {g[0].bankAccount ? (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2.5 gap-y-0.5 text-[11.5px] mb-2">
                          <div><span className="text-steel">Banco: </span><span className="font-semibold">{g[0].bankAccount.bankName}</span></div>
                          <div><span className="text-steel">Tipo: </span><span className="font-semibold">{g[0].bankAccount.bankAccountType}</span></div>
                          {g[0].bankAccount.holderIdType && (
                            <div><span className="text-steel">{g[0].bankAccount.holderIdType === "RUC" ? "RUC" : "CI"}: </span><span className="font-semibold break-all">{g[0].bankAccount.holderIdNumber}</span></div>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className="bg-teal/10 border border-teal/30 rounded-md px-2.5 py-1.5">
                            <div className="text-[9px] font-semibold uppercase tracking-wide text-teal/80">Titular</div>
                            <div className="font-display text-[16px] font-bold text-teal leading-tight break-words">{g[0].bankAccount.bankAccountHolder}</div>
                          </div>
                          <div className="bg-teal/10 border border-teal/30 rounded-md px-2.5 py-1.5">
                            <div className="text-[9px] font-semibold uppercase tracking-wide text-teal/80">N° de cuenta</div>
                            <div className="font-display text-[16px] font-bold text-teal leading-tight break-all">{g[0].bankAccount.bankAccountNumber}</div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-[11.5px] text-red">Falta registrar la cuenta bancaria del proveedor.</div>
                    )}
                  </div>
                  {payingGroup === groupId ? (
                    <div>
                      <div className="text-[11px] text-steel mb-2">Paso 2 de 2: sube el comprobante de la transferencia que ya hiciste y confirma abajo para cerrar esta solicitud.</div>
                      {reservedCredits.length > 0 && (
                        <div className="bg-teal/10 border border-teal/35 rounded-md p-3 mb-2.5">
                          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-teal mb-1.5"><Lock size={13} /> Crédito ya reservado al pedir esta solicitud</div>
                          <div className="flex flex-col gap-1 mb-1.5">
                            {reservedCredits.map((c) => (
                              <div key={c.id} className="text-[12px] text-ink">{money(c.amount)} — {c.reason}</div>
                            ))}
                          </div>
                          <div className="text-[12px] font-semibold text-ink">Neto a transferir: {money(netAmountFor(groupId))}</div>
                        </div>
                      )}
                      {availableCredits.length > 0 && (
                        <div className="bg-gold/10 border border-gold/35 rounded-md p-3 mb-2.5" style={{ color: "#D9A441" }}>
                          <div className="flex items-center gap-1.5 text-[12px] font-semibold mb-1.5"><Wallet size={13} /> Crédito adicional disponible con {g[0].supplier.name}</div>
                          <div className="flex flex-col gap-1 mb-1.5">
                            {availableCredits.map((c) => (
                              <div key={c.id} className="flex items-center gap-2 text-[12px] text-ink">
                                <input type="checkbox" className="cursor-pointer" checked={selectedCreditIds.includes(c.id)} onChange={() => toggleCredit(c.id)} />
                                {money(c.amount)} — {c.reason}
                              </div>
                            ))}
                          </div>
                          <div className="text-[12px] font-semibold text-ink">Neto a transferir: {money(netAmountFor(groupId))}</div>
                        </div>
                      )}
                      {netAmountFor(groupId) === 0 ? (
                        <div className="flex items-center gap-2 text-[12px] text-teal mb-2"><CheckCircle2 size={13} /> El crédito cubre el total — no hace falta transferir nada.</div>
                      ) : proofUrl ? (
                        <div className="flex items-center gap-2 text-[12px] mb-2">
                          {proofVerifying ? (
                            <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" />
                          ) : proofVerifyResult?.matches ? (
                            <CheckCircle2 size={13} className="text-teal" />
                          ) : proofVerifyResult ? (
                            <Lock size={13} className="text-red" />
                          ) : null}
                          <span className={proofVerifying ? "text-steel" : proofVerifyResult?.matches ? "text-teal" : proofVerifyResult ? "text-red" : "text-steel"}>
                            {proofVerifying
                              ? "Verificando con IA…"
                              : proofVerifyResult?.matches
                              ? `Verificado — coincide (${proofVerifyResult.readAmount?.toFixed(2)})`
                              : proofVerifyResult && proofVerifyResult.readAmount !== null
                              ? `No coincide — dice $${proofVerifyResult.readAmount.toFixed(2)}, revisa antes de continuar`
                              : proofVerifyResult
                              ? "No se pudo leer el monto — sube una imagen más clara"
                              : "Comprobante subido"}
                          </span>
                          <button type="button" className="text-steel ml-1 cursor-pointer" onClick={() => { setProofUrl(null); setProofVerifyResult(null); }}>Cambiar</button>
                        </div>
                      ) : (
                        <div className="mb-2">
                          <div
                            tabIndex={0}
                            onPaste={onPasteProof}
                            onMouseEnter={onPasteProofHoverIn}
                            onMouseLeave={onPasteProofHoverOut}
                            className="flex items-center gap-1.5 border-[1.5px] border-dashed border-rule rounded px-3 py-2 text-[12px] text-steel cursor-pointer hover:border-teal focus:border-teal focus:outline-none w-fit"
                          >
                            {uploadingProof ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={13} />} Pega la foto aquí (Ctrl+V)
                            <button type="button" className="text-[10.5px] underline decoration-dotted opacity-80 hover:opacity-100 cursor-pointer" onClick={() => proofFileInputRef.current?.click()}>
                              o selecciona un archivo
                            </button>
                            <input ref={proofFileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadProof(e.target.files[0])} />
                          </div>
                          <label className="flex items-center gap-1.5 mt-1 text-[10.5px] text-steel cursor-pointer hover:text-teal w-fit">
                            ¿Es un PDF? Subir documento
                            <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && uploadProof(e.target.files[0])} />
                          </label>
                        </div>
                      )}
                      {err && <div className="text-red text-[12px] mb-2">{err}</div>}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={payLocked || busyGroup === groupId || (netAmountFor(groupId) > 0 && (!proofUrl || proofVerifying || !proofVerifyResult?.matches))}
                          title={payLocked ? ADMIN_LOCK_TITLE : undefined}
                          className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
                          onClick={() => pay(groupId)}
                        >
                          Confirmar pago
                        </button>
                        <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={() => { setPayingGroup(null); setProofUrl(null); setProofVerifyResult(null); setSelectedCreditIds([]); }}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-[11px] text-steel mb-1.5">Paso 1 de 2: transfiere el monto a la cuenta de arriba (o usa el crédito, si aplica). Después haz clic aquí para subir el comprobante y cerrar la solicitud.</div>
                      <button type="button" disabled={payLocked} title={payLocked ? ADMIN_LOCK_TITLE : undefined} className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed" onClick={() => openPay(groupId, g[0].supplier.id)}>
                        💳 Subir comprobante
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pendingShippingGroups.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Fletes pendientes de pago</div>
          <div className="flex flex-col gap-2.5">
            {pendingShippingGroups.map((g) => {
              const groupId = g[0].groupId;
              const r0 = g[0];
              return (
                <div key={groupId} className="bg-surface border border-gold/40 rounded-md p-4">
                  <div className="flex items-start justify-between gap-2 mb-0.5">
                    <div className="flex items-center gap-1.5 text-[13.5px] font-bold flex-wrap">
                      <Truck size={14} />
                      {g.map((r, i) => (
                        <span key={r.id} className="flex items-center gap-1.5">
                          {i > 0 && <span className="text-steel font-normal">,</span>}
                          <CatalogCode code={r.catalogItem.justCode} />
                          <span>{r.catalogItem.name}</span>
                        </span>
                      ))}
                    </div>
                    <div className="flex flex-col items-end shrink-0 gap-0.5">
                      <span className="font-display text-[16px] font-bold text-teal leading-tight">{money(r0.shippingCostTotal ?? 0)}</span>
                      <span className="font-mono text-[10.5px] text-steel">{formatPurchaseRequestCode(r0.requestNumber)}</span>
                    </div>
                  </div>
                  <div className="text-[11.5px] text-steel">{r0.carrier?.name ?? "Transportista"}</div>
                  <div className="text-[10px] text-steel-dim mb-2.5">
                    Pedido por {actorName(r0.shippingPaymentRequestedBy?.name)}
                    {r0.shippingPaymentRequestedAt && (
                      <>
                        {" "}· {formatDateTime(r0.shippingPaymentRequestedAt)} ·{" "}
                        <span className={elapsedHours(r0.shippingPaymentRequestedAt) >= 24 ? "font-semibold text-red" : ""}>
                          lleva {elapsedLabel(r0.shippingPaymentRequestedAt)} sin gestionar
                        </span>
                      </>
                    )}
                  </div>
                  <div className="bg-cloud border border-rule rounded-md px-3 py-2.5 mb-2.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel mb-1.5">
                      <Landmark size={12} /> Transferir a {r0.carrier?.name ?? "transportista"}
                    </div>
                    {r0.carrierBankAccount ? (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2.5 gap-y-0.5 text-[11.5px] mb-2">
                          <div><span className="text-steel">Banco: </span><span className="font-semibold">{r0.carrierBankAccount.bankName}</span></div>
                          <div><span className="text-steel">Tipo: </span><span className="font-semibold">{r0.carrierBankAccount.bankAccountType}</span></div>
                          {r0.carrierBankAccount.holderIdType && (
                            <div><span className="text-steel">{r0.carrierBankAccount.holderIdType === "RUC" ? "RUC" : "CI"}: </span><span className="font-semibold break-all">{r0.carrierBankAccount.holderIdNumber}</span></div>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className="bg-teal/10 border border-teal/30 rounded-md px-2.5 py-1.5">
                            <div className="text-[9px] font-semibold uppercase tracking-wide text-teal/80">Titular</div>
                            <div className="font-display text-[16px] font-bold text-teal leading-tight break-words">{r0.carrierBankAccount.bankAccountHolder}</div>
                          </div>
                          <div className="bg-teal/10 border border-teal/30 rounded-md px-2.5 py-1.5">
                            <div className="text-[9px] font-semibold uppercase tracking-wide text-teal/80">N° de cuenta</div>
                            <div className="font-display text-[16px] font-bold text-teal leading-tight break-all">{r0.carrierBankAccount.bankAccountNumber}</div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-[11.5px] text-red">Falta registrar la cuenta bancaria del transportista.</div>
                    )}
                  </div>
                  {payingShippingGroup === groupId ? (
                    <div>
                      <div className="text-[11px] text-steel mb-2">Paso 2 de 2: si tienes el comprobante de la transferencia que ya hiciste, súbelo (opcional) y confirma abajo para cerrar esta solicitud.</div>
                      {shippingProofUrl ? (
                        <div className="flex items-center gap-2 text-[12px] mb-2">
                          {shippingProofVerifying ? (
                            <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" />
                          ) : shippingProofVerifyResult?.matches ? (
                            <CheckCircle2 size={13} className="text-teal" />
                          ) : shippingProofVerifyResult ? (
                            <Lock size={13} className="text-red" />
                          ) : null}
                          <span className={shippingProofVerifying ? "text-steel" : shippingProofVerifyResult?.matches ? "text-teal" : shippingProofVerifyResult ? "text-red" : "text-steel"}>
                            {shippingProofVerifying
                              ? "Verificando con IA…"
                              : shippingProofVerifyResult?.matches
                              ? `Verificado — coincide (${shippingProofVerifyResult.readAmount?.toFixed(2)})`
                              : shippingProofVerifyResult && shippingProofVerifyResult.readAmount !== null
                              ? `No coincide — dice $${shippingProofVerifyResult.readAmount.toFixed(2)}, revisa antes de continuar`
                              : shippingProofVerifyResult
                              ? "No se pudo leer el monto — sube una imagen más clara"
                              : "Comprobante subido"}
                          </span>
                          <button type="button" className="text-steel ml-1 cursor-pointer" onClick={() => { setShippingProofUrl(null); setShippingProofVerifyResult(null); }}>Cambiar</button>
                        </div>
                      ) : (
                        <div className="mb-2">
                          <div
                            tabIndex={0}
                            onPaste={onPasteShippingProof}
                            onMouseEnter={onPasteShippingProofHoverIn}
                            onMouseLeave={onPasteShippingProofHoverOut}
                            className="flex items-center gap-1.5 border-[1.5px] border-dashed border-rule rounded px-3 py-2 text-[12px] text-steel cursor-pointer hover:border-teal focus:border-teal focus:outline-none w-fit"
                          >
                            {uploadingShippingProof ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={13} />} Pega la foto aquí (opcional, Ctrl+V)
                            <button type="button" className="text-[10.5px] underline decoration-dotted opacity-80 hover:opacity-100 cursor-pointer" onClick={() => shippingProofFileInputRef.current?.click()}>
                              o selecciona un archivo
                            </button>
                            <input ref={shippingProofFileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadShippingProof(e.target.files[0])} />
                          </div>
                          <label className="flex items-center gap-1.5 mt-1 text-[10.5px] text-steel cursor-pointer hover:text-teal w-fit">
                            ¿Es un PDF? Subir documento
                            <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && uploadShippingProof(e.target.files[0])} />
                          </label>
                        </div>
                      )}
                      {err && <div className="text-red text-[12px] mb-2">{err}</div>}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isAdmin || busyGroup === groupId || shippingProofVerifying || (!!shippingProofUrl && !shippingProofVerifyResult?.matches)}
                          title={isAdmin ? ADMIN_LOCK_TITLE : undefined}
                          className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
                          onClick={() => payShipping(groupId)}
                        >
                          Confirmar pago del flete
                        </button>
                        <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={() => { setPayingShippingGroup(null); setShippingProofUrl(null); setShippingProofVerifyResult(null); }}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-[11px] text-steel mb-1.5">Paso 1 de 2: transfiere el monto a la cuenta de arriba. Después haz clic aquí para subir el comprobante (opcional) y cerrar la solicitud.</div>
                      <button type="button" disabled={isAdmin} title={isAdmin ? ADMIN_LOCK_TITLE : undefined} className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed" onClick={() => { setPayingShippingGroup(groupId); setShippingProofUrl(null); setShippingProofVerifyResult(null); setErr(""); }}>
                        💳 Subir comprobante
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel">Registrar factura</div>
        <span className="font-mono text-[10px] text-steel">{restGroups.length} de {restGroupsAll.length}</span>
      </div>
      <div className="flex items-center gap-2 mb-3 flex-wrap text-[12px]">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-steel" />
          <input
            type="text"
            placeholder="Buscar producto, proveedor o código…"
            className="rounded border border-rule bg-cloud pl-7 pr-2.5 py-1.5 w-64"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="rounded border border-rule bg-cloud px-2 py-1.5 font-mono"
          value={monthFilter}
          onChange={(e) => applyMonthFilter(e.target.value)}
        >
          <option value="">Todos los meses</option>
          {recentMonths().map((m) => (
            <option key={m} value={m}>{monthFilterLabel(m)}</option>
          ))}
        </select>
        <button type="button" className="rounded border border-rule px-2.5 py-1.5 text-steel cursor-pointer hover:border-teal" onClick={applyPrevMonth}>
          Mes anterior
        </button>
        <label className="flex items-center gap-1.5 text-steel">
          Desde
          <input type="date" className="rounded border border-rule bg-cloud px-2 py-1.5" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setMonthFilter(""); }} />
        </label>
        <label className="flex items-center gap-1.5 text-steel">
          Hasta
          <input type="date" className="rounded border border-rule bg-cloud px-2 py-1.5" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setMonthFilter(""); }} />
        </label>
        {(dateFrom || dateTo || query) && (
          <button type="button" className="text-steel underline cursor-pointer" onClick={() => { clearDateFilter(); setQuery(""); }}>Limpiar</button>
        )}
      </div>
      {restGroups.length === 0 && <div className="border-[1.5px] border-dashed border-rule rounded-md p-6 text-center text-steel text-[13px]">{restGroupsAll.length === 0 ? "Nada por aquí todavía." : "Nada en ese rango de fechas."}</div>}
      <div className="flex flex-col gap-2.5">
        {restGroups.map((g) => {
          const groupId = g[0].groupId;
          const total = g.reduce((s, r) => s + r.totalCost, 0);
          const r0 = g[0];
          const isYes = (choice[groupId] ?? "YES") === "YES";
          return (
            <div key={groupId} className="bg-surface border border-rule rounded-md p-4">
              <div className="mb-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    {g.map((r) => (
                      <div key={r.id} className="text-[13.5px] font-bold flex items-center gap-1.5 flex-wrap">
                        <CatalogCode code={r.catalogItem.justCode} />
                        <span>{r.catalogItem.name} · {r.quantity} un.</span>
                      </div>
                    ))}
                  </div>
                  <span className="font-mono text-[10.5px] text-steel shrink-0">{formatPurchaseRequestCode(r0.requestNumber)}</span>
                </div>
                <div className="text-[11.5px] text-steel">{r0.supplier.name} — Pagado {money(total)} {r0.paidAt ? `· ${formatDateTime(r0.paidAt)}` : ""}</div>
                <div className="text-[10px] text-steel-dim">
                  Solicitada por {actorName(r0.requestedBy?.name)} · Pagada por {actorName(r0.paidBy?.name)}
                  {r0.invoiceStatus === "PENDING" && r0.paidAt && (
                    <>
                      {" "}·{" "}
                      <span className={elapsedHours(r0.paidAt) >= 24 ? "font-semibold text-red" : ""}>
                        lleva {elapsedLabel(r0.paidAt)} sin factura registrada
                      </span>
                    </>
                  )}
                </div>
              </div>

              {(() => {
                const openReports = openReportsForGroup(groupId);
                if (openReports.length === 0) return null;
                return (
                  <div className="flex items-center gap-2 bg-red/10 border border-red/30 rounded-md px-3 py-2 mb-2.5 text-[12px] text-red">
                    <span className="w-1.5 h-1.5 rounded-full bg-red shrink-0" />
                    Esta operación todavía tiene algo pendiente con el proveedor — {openReports.length} reporte{openReports.length === 1 ? "" : "s"} urgente sin resolver del todo.
                  </div>
                );
              })()}

              {r0.financeFlagNote ? (
                <div className="flex items-start justify-between gap-2 bg-gold/10 border border-gold/35 rounded-md px-3 py-2 mb-2.5 text-[12px]" style={{ color: "#D9A441" }}>
                  <div>
                    <div className="font-semibold">⚠️ Revisar: {r0.financeFlagNote}</div>
                    <div className="text-steel mt-0.5">Marcado por {actorName(r0.financeFlaggedBy?.name)}{r0.financeFlaggedAt ? ` · ${formatDateTime(r0.financeFlaggedAt)}` : ""}</div>
                  </div>
                  <button type="button" disabled={isAdmin} title={isAdmin ? ADMIN_LOCK_TITLE : undefined} className="text-steel underline text-[11px] cursor-pointer shrink-0 disabled:opacity-60 disabled:cursor-not-allowed" onClick={() => saveFinanceFlag(groupId, null)}>quitar</button>
                </div>
              ) : flagOpenGroupId === groupId ? (
                <div className="bg-cloud rounded-md p-2.5 mb-2.5">
                  <textarea className="w-full rounded border border-rule px-2.5 py-2 text-[12px] mb-2" rows={2} placeholder="¿Qué hay que revisar en esta operación?" value={flagNote} onChange={(e) => setFlagNote(e.target.value)} />
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={isAdmin || busyGroup === groupId || !flagNote.trim()} title={isAdmin ? ADMIN_LOCK_TITLE : undefined} className="rounded border border-gold/50 px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer disabled:opacity-60" style={{ color: "#D9A441" }} onClick={() => saveFinanceFlag(groupId, flagNote.trim())}>
                      Marcar para revisar
                    </button>
                    <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => setFlagOpenGroupId(null)}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <button type="button" disabled={isAdmin} title={isAdmin ? ADMIN_LOCK_TITLE : undefined} className="text-steel text-[11px] underline cursor-pointer mb-2.5 disabled:opacity-60 disabled:cursor-not-allowed" onClick={() => { setFlagOpenGroupId(groupId); setFlagNote(""); }}>
                  ⚠️ Algo no cuadra — marcar para revisar
                </button>
              )}

              {r0.invoiceStatus === "PENDING" && isAdmin ? (
                <div className="flex items-center gap-1.5 border-[1.5px] border-dashed border-rule rounded-md px-3 py-3 text-[12px] text-steel">
                  <Lock size={13} className="shrink-0" /> Pendiente de que Nairoby registre la factura — {ADMIN_LOCK_TITLE.toLowerCase()}.
                </div>
              ) : r0.invoiceStatus === "PENDING" ? (
                <div>
                  <div className="flex gap-2 mb-2.5">
                    <button
                      type="button"
                      className={`flex-1 rounded-md border py-1.5 text-[12px] font-semibold cursor-pointer ${isYes ? "border-teal bg-teal/10 text-teal" : "border-rule text-steel"}`}
                      onClick={() => setChoice((c) => ({ ...c, [groupId]: "YES" }))}
                    >
                      Sí tiene factura
                    </button>
                    <button
                      type="button"
                      className={`flex-1 rounded-md border py-1.5 text-[12px] font-semibold cursor-pointer ${!isYes ? "border-red/50 bg-red/10 text-red" : "border-rule text-steel"}`}
                      onClick={() => setChoice((c) => ({ ...c, [groupId]: "NO" }))}
                    >
                      No hay factura en esta operación
                    </button>
                  </div>

                  {isYes ? (
                    <div className="bg-cloud border border-rule rounded-md p-3">
                      <div className="flex gap-2 mb-2.5">
                        <button
                          type="button"
                          className={`flex-1 rounded border py-1 text-[11.5px] font-semibold cursor-pointer ${(invoiceType[groupId] ?? "COMPLETE") === "COMPLETE" ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}
                          onClick={() => setInvoiceType((t) => ({ ...t, [groupId]: "COMPLETE" }))}
                        >
                          Por el total pagado
                        </button>
                        <button
                          type="button"
                          className={`flex-1 rounded border py-1 text-[11.5px] font-semibold cursor-pointer ${invoiceType[groupId] === "PARTIAL" ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}
                          onClick={() => setInvoiceType((t) => ({ ...t, [groupId]: "PARTIAL" }))}
                        >
                          Por una parte
                        </button>
                      </div>
                      {invoiceType[groupId] === "PARTIAL" && (
                        <input
                          type="number" step="0.01" placeholder="¿Por qué valor se facturó?"
                          className="w-full rounded border border-rule px-2.5 py-1.5 text-[12.5px] mb-2.5"
                          value={partialAmounts[groupId] ?? ""}
                          onChange={(e) => setPartialAmounts((p) => ({ ...p, [groupId]: e.target.value }))}
                        />
                      )}
                      {invoiceDocUrl[groupId] ? (
                        <div className="mb-2.5">
                          <div className="flex items-center gap-1.5 text-[11.5px] text-teal mb-1.5">
                            <CheckCircle2 size={13} /> Documento subido — revisa que se vea bien antes de guardar
                          </div>
                          {isImageUrl(invoiceDocUrl[groupId]) ? (
                            <a href={invoiceDocUrl[groupId]} target="_blank" rel="noopener noreferrer" className="block w-fit">
                              <img src={invoiceDocUrl[groupId]} alt="Vista previa de la factura" className="max-h-52 rounded border border-rule" />
                            </a>
                          ) : (
                            <iframe src={invoiceDocUrl[groupId]} className="w-full h-52 rounded border border-rule bg-white" title="Vista previa de la factura" />
                          )}
                          <button
                            type="button"
                            className="text-steel text-[11px] underline cursor-pointer mt-1.5"
                            onClick={() => setInvoiceDocUrl((m) => { const next = { ...m }; delete next[groupId]; return next; })}
                          >
                            Cambiar documento
                          </button>
                        </div>
                      ) : (
                        <div className="mb-2.5">
                          <label
                            tabIndex={0}
                            onPaste={onPasteInvoiceDoc}
                            onMouseEnter={() => { invoiceDocGroupRef.current = groupId; armInvoiceDocPaste(); }}
                            onMouseLeave={() => { invoiceDocGroupRef.current = null; disarmInvoiceDocPaste(); }}
                            className="flex items-center gap-1.5 border-[1.5px] border-dashed border-rule rounded px-3 py-2 text-[11.5px] text-steel cursor-pointer hover:border-teal focus:border-teal focus:outline-none w-fit"
                          >
                            {uploadingDoc === groupId ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={12} />} Subir o pegar la factura (opcional)
                            {/* Confirmado 2026-08-06: accept="image/*,application/pdf" hacía que el
                                celular mostrara el selector genérico de "Cámara y archivos" en vez
                                del acceso directo a la última foto — se separa el PDF como opción
                                aparte, mismo fix ya aplicado en PurchaseRequestForm.tsx. */}
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadInvoiceDoc(groupId, e.target.files[0])} />
                          </label>
                          <label className="flex items-center gap-1 mt-1 text-[10.5px] text-steel cursor-pointer hover:text-teal w-fit">
                            ¿Es un PDF? Subir documento
                            <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && uploadInvoiceDoc(groupId, e.target.files[0])} />
                          </label>
                        </div>
                      )}
                      {err && <div className="text-red text-[12px] mb-2">{err}</div>}
                      <div>
                        <button
                          type="button"
                          disabled={isAdmin || busyGroup === groupId || (invoiceType[groupId] === "PARTIAL" && !partialAmounts[groupId])}
                          title={isAdmin ? ADMIN_LOCK_TITLE : undefined}
                          className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60"
                          onClick={() => finalizeYes(groupId)}
                        >
                          Guardar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button type="button" disabled={isAdmin || busyGroup === groupId} title={isAdmin ? ADMIN_LOCK_TITLE : undefined} className="flex-1 rounded border border-rule px-3 py-2 text-[12px] font-semibold text-steel cursor-pointer disabled:opacity-60" onClick={() => setInvoice(groupId, "NON_FISCAL")}>
                        Me dieron comprobante (no fiscal)
                      </button>
                      <button type="button" disabled={isAdmin || busyGroup === groupId} title={isAdmin ? ADMIN_LOCK_TITLE : undefined} className="flex-1 rounded border border-red/50 text-red px-3 py-2 text-[12px] font-semibold cursor-pointer disabled:opacity-60" onClick={() => setInvoice(groupId, "NONE")}>
                        No entregaron nada
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-cloud border border-rule rounded-md px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[12px] text-teal">
                      <CheckCircle2 size={13} /> {INVOICE_LABELS[r0.invoiceStatus]}{r0.invoiceStatus === "PARTIAL" && r0.invoiceAmount ? ` — ${money(r0.invoiceAmount)}` : ""}
                    </div>
                    {r0.invoiceDocUrl && (
                      <a href={r0.invoiceDocUrl} target="_blank" rel="noopener noreferrer" className="text-[11.5px] text-blue font-semibold whitespace-nowrap">Ver documento</a>
                    )}
                  </div>
                  <div className="text-[10px] text-steel-dim mt-0.5">Registrada por {actorName(r0.invoicedBy?.name)}{r0.invoicedAt ? ` · ${formatDateTime(r0.invoicedAt)}` : ""}</div>
                  {!g.every((r) => r.status === "RECEIVED") && (
                    <div className="flex items-center gap-1.5 text-[11px] mt-1.5 pt-1.5 border-t border-rule" style={{ color: "#D9A441" }}>
                      <AlertTriangle size={12} className="shrink-0" /> Sigue aquí hasta que Inventario confirme que llegó todo — recién ahí pasa a Auditoría.
                    </div>
                  )}

                  {reuploadOpenGroupId === groupId ? (
                    <div className="mt-2 pt-2 border-t border-rule">
                      {replaceDocUrl[groupId] ? (
                        <div className="mb-2">
                          <div className="flex items-center gap-1.5 text-[11.5px] text-teal mb-1.5">
                            <CheckCircle2 size={13} /> Nuevo documento listo — revísalo antes de reemplazar
                          </div>
                          {isImageUrl(replaceDocUrl[groupId]) ? (
                            <a href={replaceDocUrl[groupId]} target="_blank" rel="noopener noreferrer" className="block w-fit">
                              <img src={replaceDocUrl[groupId]} alt="Vista previa del nuevo documento" className="max-h-52 rounded border border-rule" />
                            </a>
                          ) : (
                            <iframe src={replaceDocUrl[groupId]} className="w-full h-52 rounded border border-rule bg-white" title="Vista previa del nuevo documento" />
                          )}
                          <a href={replaceDocUrl[groupId]} target="_blank" rel="noopener noreferrer" className="block text-[11px] text-blue font-semibold mt-1.5 w-fit">Ver en pestaña nueva</a>
                          <button
                            type="button"
                            className="text-steel text-[11px] underline cursor-pointer mt-1.5 block"
                            onClick={() => { setReplaceDocUrl((m) => { const next = { ...m }; delete next[groupId]; return next; }); setReplaceConfirming((m) => ({ ...m, [groupId]: false })); }}
                          >
                            Subir otro archivo
                          </button>
                        </div>
                      ) : (
                        <div className="mb-2">
                          <label className="flex items-center gap-1.5 border-[1.5px] border-dashed border-rule rounded px-3 py-2 text-[11.5px] text-steel cursor-pointer hover:border-teal w-fit">
                            {uploadingReplaceDoc === groupId ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={12} />} Selecciona el nuevo documento
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadReplaceDoc(groupId, e.target.files[0])} />
                          </label>
                          <label className="flex items-center gap-1 mt-1 text-[10.5px] text-steel cursor-pointer hover:text-teal w-fit">
                            ¿Es un PDF? Subir documento
                            <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && uploadReplaceDoc(groupId, e.target.files[0])} />
                          </label>
                        </div>
                      )}
                      {err && <div className="text-red text-[12px] mb-2">{err}</div>}
                      <div className="flex items-center gap-2">
                        {replaceConfirming[groupId] ? (
                          <>
                            <span className="text-[11.5px] text-red font-semibold">¿Seguro? Esto reemplaza el documento ya guardado.</span>
                            <button
                              type="button"
                              disabled={replacingDoc === groupId}
                              className="rounded border border-red/60 bg-red/10 px-3 py-1.5 text-[11.5px] font-semibold text-red cursor-pointer disabled:opacity-60"
                              onClick={() => confirmReplaceDoc(groupId)}
                            >
                              Sí, reemplazar
                            </button>
                            <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => setReplaceConfirming((m) => ({ ...m, [groupId]: false }))}>Cancelar</button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={!replaceDocUrl[groupId]}
                              className="rounded border border-blue bg-blue px-3 py-1.5 text-[11.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
                              onClick={() => confirmReplaceDoc(groupId)}
                            >
                              Reemplazar documento
                            </button>
                            <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => cancelReupload(groupId)}>Cancelar</button>
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={isAdmin}
                      title={isAdmin ? ADMIN_LOCK_TITLE : undefined}
                      className="text-blue text-[11px] font-semibold underline cursor-pointer mt-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                      onClick={() => openReupload(groupId)}
                    >
                      Volver a subir el documento de factura
                    </button>
                  )}
                </div>
              )}

              <div className="mt-3">
                <PurchaseOperationDocuments rows={g.map(toDocRow)} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
