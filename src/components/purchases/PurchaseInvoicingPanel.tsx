"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, CheckCircle2, Truck, Lock, Wallet } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";
import { actorName } from "@/lib/actorName";
import { PurchaseOperationDocuments, type OperationDocRow } from "./PurchaseOperationDocuments";

type InvoiceStatus = "PENDING" | "COMPLETE" | "PARTIAL" | "NON_FISCAL" | "NONE";

type Row = {
  id: string;
  groupId: string;
  status: "APPROVED" | "PAID" | "RECEIVED";
  quantity: number;
  totalCost: number;
  invoiceStatus: InvoiceStatus;
  invoiceAmount: number | null;
  invoiceDocUrl: string | null;
  invoicedBy: { name: string } | null;
  paidAt: string | null;
  paidBy: { name: string } | null;
  requestedBy: { name: string } | null;
  catalogItem: { name: string; photos: string[] };
  supplier: { id: string; name: string };
  shippingIncluded: boolean;
  shippingPaymentTiming: "WITH_PURCHASE" | "ON_DELIVERY" | null;
  shippingCostTotal: number | null;
  carrier: { name: string } | null;
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

export function PurchaseInvoicingPanel() {
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
  // Confirmado 2026-08-06: filtro de fechas para "Registrar factura" — sin
  // esto la lista crece para siempre con todo el historial. dateFrom/dateTo
  // vacíos = sin filtro (se ve todo). El selector de mes y "Mes anterior"
  // solo son atajos que rellenan estos dos campos.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [urgentReports, setUrgentReports] = useState<UrgentReportSummary[]>([]);
  const [flagOpenGroupId, setFlagOpenGroupId] = useState<string | null>(null);
  const [flagNote, setFlagNote] = useState("");
  const { onPaste: onPasteProof, onMouseEnter: onPasteProofHoverIn, onMouseLeave: onPasteProofHoverOut } = usePasteFile((file) => uploadProof(file));
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

  const [payingShippingGroup, setPayingShippingGroup] = useState<string | null>(null);
  const [shippingProofUrl, setShippingProofUrl] = useState<string | null>(null);
  const [uploadingShippingProof, setUploadingShippingProof] = useState(false);
  const [shippingProofVerifying, setShippingProofVerifying] = useState(false);
  const [shippingProofVerifyResult, setShippingProofVerifyResult] = useState<{ readAmount: number | null; matches: boolean; receiptNumber: string | null } | null>(null);
  const { onPaste: onPasteShippingProof, onMouseEnter: onPasteShippingProofHoverIn, onMouseLeave: onPasteShippingProofHoverOut } = usePasteFile((file) => uploadShippingProof(file));

  // Confirmado 2026-07-31: por defecto se asume que SÍ hay factura (pide
  // completa/parcial + documento opcional) — "No hay factura" es la
  // excepción que se elige a propósito, con dos botones de un solo clic
  // (comprobante no fiscal / no entregaron nada) que finalizan al toque.
  const [choice, setChoice] = useState<Record<string, "YES" | "NO">>({});
  const [invoiceType, setInvoiceType] = useState<Record<string, "COMPLETE" | "PARTIAL">>({});
  const [invoiceDocUrl, setInvoiceDocUrl] = useState<Record<string, string>>({});
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);

  function load() {
    fetch("/api/purchase-requests?view=invoicing").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
    fetch("/api/purchase-requests/petty-cash-summary").then((r) => (r.ok ? r.json() : null)).then(setPettyCash).catch(() => null);
    fetch("/api/purchase-requests/urgent-reports").then((r) => (r.ok ? r.json() : [])).then(setUrgentReports).catch(() => setUrgentReports([]));
  }
  useEffect(load, []);

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
    const appliedTotal = availableCredits.filter((c) => selectedCreditIds.includes(c.id)).reduce((s, c) => s + c.amount, 0);
    return Math.max(0, total - appliedTotal);
  }

  // Confirmado 2026-08-06: al abrir "Marcar como pagado" se consulta si el
  // proveedor tiene crédito disponible (por mercadería dañada/incompleta de
  // una compra anterior) — se puede aplicar aquí para pagar solo la
  // diferencia, en vez de perderlo o tener que recordarlo a mano.
  async function openPay(groupId: string, supplierId: string) {
    setPayingGroup(groupId);
    setProofUrl(null);
    setProofVerifyResult(null);
    setSelectedCreditIds([]);
    setErr("");
    const res = await fetch(`/api/purchase-suppliers/${supplierId}/credit-balance`);
    const data = await res.json().catch(() => null);
    setAvailableCredits(res.ok ? data.credits : []);
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

  if (!rows) return <div className="text-steel text-[13px]">Cargando…</div>;

  const approvedGroups = groupRows(rows.filter((r) => r.status === "APPROVED"));
  const restGroupsAll = groupRows(rows.filter((r) => r.status !== "APPROVED"));
  // Confirmado 2026-08-06: por fecha de pago (paidAt) — es lo que ya se ve
  // impreso en cada tarjeta ("Pagado ... · fecha"), así el filtro coincide
  // con lo que la persona está mirando.
  const restGroups = (dateFrom || dateTo)
    ? restGroupsAll.filter((g) => {
        const d = g[0].paidAt?.slice(0, 10);
        if (!d) return true;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
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
    rows.filter((r) => !r.shippingIncluded && r.shippingPaymentTiming === "ON_DELIVERY" && r.shippingPaymentRequestedAt && !r.shippingPaidAt)
  );

  return (
    <div>
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
                  {g.map((r) => (
                    <div key={r.id} className="text-[13.5px] font-bold">{r.catalogItem.name} · {r.quantity} un.</div>
                  ))}
                  <div className="text-[11.5px] text-steel">{g[0].supplier.name} — {money(total)}</div>
                  <div className="text-[10px] text-steel-dim mb-2.5">Solicitada por {actorName(g[0].requestedBy?.name)}</div>
                  {payingGroup === groupId ? (
                    <div>
                      {availableCredits.length > 0 && (
                        <div className="bg-gold/10 border border-gold/35 rounded-md p-3 mb-2.5" style={{ color: "#D9A441" }}>
                          <div className="flex items-center gap-1.5 text-[12px] font-semibold mb-1.5"><Wallet size={13} /> Crédito disponible con {g[0].supplier.name}</div>
                          <div className="flex flex-col gap-1 mb-1.5">
                            {availableCredits.map((c) => (
                              <label key={c.id} className="flex items-center gap-2 text-[12px] text-ink cursor-pointer">
                                <input type="checkbox" checked={selectedCreditIds.includes(c.id)} onChange={() => toggleCredit(c.id)} />
                                {money(c.amount)} — {c.reason}
                              </label>
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
                          <label
                            tabIndex={0}
                            onPaste={onPasteProof}
                            onMouseEnter={onPasteProofHoverIn}
                            onMouseLeave={onPasteProofHoverOut}
                            className="flex items-center gap-1.5 border-[1.5px] border-dashed border-rule rounded px-3 py-2 text-[12px] text-steel cursor-pointer hover:border-teal focus:border-teal focus:outline-none w-fit"
                          >
                            {uploadingProof ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={13} />} Subir o pegar foto (pasa el mouse y Ctrl+V)
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadProof(e.target.files[0])} />
                          </label>
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
                          disabled={busyGroup === groupId || (netAmountFor(groupId) > 0 && (!proofUrl || proofVerifying || !proofVerifyResult?.matches))}
                          className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
                          onClick={() => pay(groupId)}
                        >
                          Confirmar pago
                        </button>
                        <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={() => { setPayingGroup(null); setProofUrl(null); setProofVerifyResult(null); setSelectedCreditIds([]); }}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer" onClick={() => openPay(groupId, g[0].supplier.id)}>
                      💳 Marcar como pagado
                    </button>
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
                  <div className="flex items-center gap-1.5 text-[13.5px] font-bold mb-0.5">
                    <Truck size={14} /> {g.map((r) => r.catalogItem.name).join(", ")}
                  </div>
                  <div className="text-[11.5px] text-steel">{r0.carrier?.name ?? "Transportista"} — {money(r0.shippingCostTotal ?? 0)}</div>
                  <div className="text-[10px] text-steel-dim mb-2.5">Pedido por {actorName(r0.shippingPaymentRequestedBy?.name)}</div>
                  {payingShippingGroup === groupId ? (
                    <div>
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
                          <label
                            tabIndex={0}
                            onPaste={onPasteShippingProof}
                            onMouseEnter={onPasteShippingProofHoverIn}
                            onMouseLeave={onPasteShippingProofHoverOut}
                            className="flex items-center gap-1.5 border-[1.5px] border-dashed border-rule rounded px-3 py-2 text-[12px] text-steel cursor-pointer hover:border-teal focus:border-teal focus:outline-none w-fit"
                          >
                            {uploadingShippingProof ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={13} />} Subir o pegar foto (opcional, pasa el mouse y Ctrl+V)
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadShippingProof(e.target.files[0])} />
                          </label>
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
                          disabled={busyGroup === groupId || shippingProofVerifying || (!!shippingProofUrl && !shippingProofVerifyResult?.matches)}
                          className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
                          onClick={() => payShipping(groupId)}
                        >
                          Confirmar pago del flete
                        </button>
                        <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={() => { setPayingShippingGroup(null); setShippingProofUrl(null); setShippingProofVerifyResult(null); }}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer" onClick={() => { setPayingShippingGroup(groupId); setShippingProofUrl(null); setShippingProofVerifyResult(null); setErr(""); }}>
                      💳 Marcar flete como pagado
                    </button>
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
        {(dateFrom || dateTo) && (
          <button type="button" className="text-steel underline cursor-pointer" onClick={clearDateFilter}>Limpiar</button>
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
                {g.map((r) => (
                  <div key={r.id} className="text-[13.5px] font-bold">{r.catalogItem.name} · {r.quantity} un.</div>
                ))}
                <div className="text-[11.5px] text-steel">{r0.supplier.name} — Pagado {money(total)} {r0.paidAt ? `· ${new Date(r0.paidAt).toLocaleDateString("es-MX")}` : ""}</div>
                <div className="text-[10px] text-steel-dim">
                  Solicitada por {actorName(r0.requestedBy?.name)} · Pagada por {actorName(r0.paidBy?.name)}
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
                    <div className="text-steel mt-0.5">Marcado por {actorName(r0.financeFlaggedBy?.name)}{r0.financeFlaggedAt ? ` · ${new Date(r0.financeFlaggedAt).toLocaleDateString("es-MX")}` : ""}</div>
                  </div>
                  <button type="button" className="text-steel underline text-[11px] cursor-pointer shrink-0" onClick={() => saveFinanceFlag(groupId, null)}>quitar</button>
                </div>
              ) : flagOpenGroupId === groupId ? (
                <div className="bg-cloud rounded-md p-2.5 mb-2.5">
                  <textarea className="w-full rounded border border-rule px-2.5 py-2 text-[12px] mb-2" rows={2} placeholder="¿Qué hay que revisar en esta operación?" value={flagNote} onChange={(e) => setFlagNote(e.target.value)} />
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={busyGroup === groupId || !flagNote.trim()} className="rounded border border-gold/50 px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer disabled:opacity-60" style={{ color: "#D9A441" }} onClick={() => saveFinanceFlag(groupId, flagNote.trim())}>
                      Marcar para revisar
                    </button>
                    <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => setFlagOpenGroupId(null)}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="text-steel text-[11px] underline cursor-pointer mb-2.5" onClick={() => { setFlagOpenGroupId(groupId); setFlagNote(""); }}>
                  ⚠️ Algo no cuadra — marcar para revisar
                </button>
              )}

              {r0.invoiceStatus === "PENDING" ? (
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
                          disabled={busyGroup === groupId || (invoiceType[groupId] === "PARTIAL" && !partialAmounts[groupId])}
                          className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60"
                          onClick={() => finalizeYes(groupId)}
                        >
                          Guardar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button type="button" disabled={busyGroup === groupId} className="flex-1 rounded border border-rule px-3 py-2 text-[12px] font-semibold text-steel cursor-pointer disabled:opacity-60" onClick={() => setInvoice(groupId, "NON_FISCAL")}>
                        Me dieron comprobante (no fiscal)
                      </button>
                      <button type="button" disabled={busyGroup === groupId} className="flex-1 rounded border border-red/50 text-red px-3 py-2 text-[12px] font-semibold cursor-pointer disabled:opacity-60" onClick={() => setInvoice(groupId, "NONE")}>
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
                  <div className="text-[10px] text-steel-dim mt-0.5">Registrada por {actorName(r0.invoicedBy?.name)}</div>
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
