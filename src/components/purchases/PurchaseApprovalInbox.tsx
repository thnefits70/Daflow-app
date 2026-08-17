"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Upload, CheckCircle2, AlertTriangle, Lock, Landmark, LineChart, ChevronDown, Award } from "lucide-react";
import { actorName } from "@/lib/actorName";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";
import { PriceTrendChart } from "./PriceTrendChart";
import type { SupplierPriceHistory } from "@/lib/purchases";

type BankAccount = {
  id: string;
  bankName: string;
  bankAccountType: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  holderIdType: "RUC" | "CEDULA" | null;
  holderIdNumber: string | null;
};

type Row = {
  id: string;
  groupId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  justification: string | null;
  quoteImageUrl: string;
  quoteReadTotal: number | null;
  quoteReferenceCode: string | null;
  purchaseOrderUrl: string | null;
  shippingIncluded: boolean;
  shippingPaymentTiming: "WITH_PURCHASE" | "ON_DELIVERY" | null;
  shippingCostTotal: number | null;
  catalogItemId: string;
  catalogItem: { name: string };
  supplier: { id: string; name: string };
  bankAccount: BankAccount | null;
  bankAccountChangeRequestedAt: string | null;
  bankAccountChangeNote: string | null;
  requestedBy: { name: string } | null;
  attemptNumber: number;
};

function attemptLabel(n: number) {
  if (n === 2) return "2do intento";
  if (n === 3) return "3er intento";
  return `${n}to intento`;
}

function isPdf(url: string) {
  return /\.pdf($|\?)/i.test(url);
}

function groupRows(rows: Row[]) {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    if (!map.has(r.groupId)) map.set(r.groupId, []);
    map.get(r.groupId)!.push(r);
  }
  return [...map.values()];
}

// Confirmado 2026-08-03: descripción determinista (no un llamado nuevo a la
// IA) armada con datos que YA quedaron verificados al solicitar — si el
// grupo existe es porque el total ya cuadró con la cotización o se confirmó
// manualmente el código con la orden de compra de respaldo. Solo dos cosas
// cuentan como "novedad" real: precio sobre el historial, o código sin
// nombre de producto.
function buildValidationSummary(g: Row[]) {
  const r0 = g[0];
  const total = g.reduce((s, r) => s + r.totalCost, 0);
  const justification = g.find((r) => r.justification)?.justification ?? null;
  const codeOnly = !!r0.quoteReferenceCode;
  const parts: string[] = [];
  if (codeOnly) {
    parts.push("La cotización solo traía el código del proveedor, sin nombre de producto — se confirmó manualmente y hay una orden de compra de respaldo.");
  } else {
    parts.push(`Cotización verificada por IA — el total leído coincide con los $${total.toFixed(2)} escritos.`);
  }
  if (justification) {
    parts.push(`Uno o más productos superan el historial de precio — justificación: "${justification}"`);
  }
  const hasIssue = !!justification;
  if (!hasIssue) parts.push("Sin novedades — todo cuadra correctamente.");
  return { text: parts.join(" "), hasIssue };
}

export function PurchaseApprovalInbox() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const [rejectingGroup, setRejectingGroup] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approvingGroup, setApprovingGroup] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [proofVerifying, setProofVerifying] = useState(false);
  const [proofVerifyResult, setProofVerifyResult] = useState<{ readAmount: number | null; matches: boolean; receiptNumber: string | null } | null>(null);
  const [shippingProofUrl, setShippingProofUrl] = useState<string | null>(null);
  const [uploadingShippingProof, setUploadingShippingProof] = useState(false);
  const [shippingProofVerifying, setShippingProofVerifying] = useState(false);
  const [shippingProofVerifyResult, setShippingProofVerifyResult] = useState<{ readAmount: number | null; matches: boolean; receiptNumber: string | null } | null>(null);
  const [err, setErr] = useState("");
  const [requestingAccountChangeFor, setRequestingAccountChangeFor] = useState<string | null>(null);
  const [accountChangeNote, setAccountChangeNote] = useState("");
  const [busyAccountGroup, setBusyAccountGroup] = useState<string | null>(null);

  // Confirmado 2026-08-13: fix — esta pantalla no tenía en cuenta el
  // crédito que ya quedó reservado para esta solicitud desde que se pidió
  // (ver reserveCreditsForGroup), así que mostraba el total completo y
  // exigía comprobante por el total, aunque el crédito fuera a cubrir todo
  // o parte. El servidor (/pay) ya lo descuenta solo — esto es para que la
  // pantalla muestre y valide lo mismo que de verdad se va a cobrar, desde
  // que se carga la bandeja (no solo al abrir "Aprobar").
  const [reservedCreditsByGroup, setReservedCreditsByGroup] = useState<Record<string, { id: string; amount: number; reason: string }[]>>({});

  // Confirmado 2026-08-17: pedido explícito del usuario — quien aprueba
  // quiere ver el precio y sus fechas de pago en una gráfica de tendencia,
  // no solo el badge "Sobre el historial", antes de decidir. Se abre por
  // grupo (groupId) y se cachea por producto (catalogItemId) para no
  // repetir el fetch si hay varios grupos pendientes del mismo insumo.
  const [historyOpenGroup, setHistoryOpenGroup] = useState<string | null>(null);
  const [historyByCatalogItem, setHistoryByCatalogItem] = useState<Record<string, SupplierPriceHistory[] | null>>({});
  // Confirmado 2026-08-17: el mismo insumo se le compra a varios proveedores
  // — el panel lista TODOS (más barato primero), no solo el de esta
  // solicitud, reusando la misma data que ya carga "Comparar precios". Cada
  // fila es un acordeón aparte con su propia gráfica de tendencia: solo
  // pagos YA confirmados (paidAt), últimos 6 y un clic para ir sumando los
  // anteriores.
  const HISTORY_WINDOW = 6;
  const [openSupplierId, setOpenSupplierId] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const { onPaste: onPasteProof, onMouseEnter: onPasteProofHoverIn, onMouseLeave: onPasteProofHoverOut } = usePasteFile((file) => uploadProof(file));
  const { onPaste: onPasteShippingProof, onMouseEnter: onPasteShippingProofHoverIn, onMouseLeave: onPasteShippingProofHoverOut } = usePasteFile((file) => uploadShippingProof(file));

  function toggleHistory(groupId: string, catalogItemId: string) {
    setOpenSupplierId(null);
    setHistoryExpanded(false);
    setHistoryOpenGroup((cur) => (cur === groupId ? null : groupId));
    if (historyByCatalogItem[catalogItemId] !== undefined) return;
    setHistoryByCatalogItem((m) => ({ ...m, [catalogItemId]: null }));
    fetch(`/api/purchase-catalog/${catalogItemId}/supplier-comparison`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: SupplierPriceHistory[]) => setHistoryByCatalogItem((m) => ({ ...m, [catalogItemId]: data })))
      .catch(() => setHistoryByCatalogItem((m) => ({ ...m, [catalogItemId]: [] })));
  }

  function toggleSupplierRow(supplierId: string) {
    setHistoryExpanded(false);
    setOpenSupplierId((cur) => (cur === supplierId ? null : supplierId));
  }

  function load() {
    fetch("/api/purchase-requests?view=approval")
      .then((r) => (r.ok ? r.json() : []))
      .then(async (data: Row[]) => {
        setRows(data);
        const groups = groupRows(data);
        const entries = await Promise.all(
          groups.map(async (g) => {
            const groupId = g[0].groupId;
            const res = await fetch(`/api/purchase-suppliers/${g[0].supplier.id}/credit-balance?groupId=${groupId}`);
            const d = await res.json().catch(() => null);
            return [groupId, res.ok ? d.reserved ?? [] : []] as const;
          })
        );
        setReservedCreditsByGroup(Object.fromEntries(entries));
      })
      .catch(() => setRows([]));
  }
  useEffect(load, []);

  function currentGroupRows(groupId: string) {
    return (rows ?? []).filter((r) => r.groupId === groupId);
  }

  function reservedTotalFor(groupId: string) {
    return (reservedCreditsByGroup[groupId] ?? []).reduce((s, c) => s + c.amount, 0);
  }

  function netAmountFor(groupId: string) {
    const total = currentGroupRows(groupId).reduce((s, r) => s + r.totalCost, 0);
    return Math.max(0, total - reservedTotalFor(groupId));
  }

  // Confirmado 2026-08-04: la IA lee el comprobante y se compara contra lo
  // que de verdad correspondía pagar — si no cuadra (o no se puede leer un
  // monto), "Aprobar y confirmar pago" queda bloqueado hasta corregir. Nunca
  // se avanza con un comprobante sin verificar, así se haya cerrado la
  // pestaña a medio camino o lo que sea.
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

  async function uploadProof(file: File) {
    if (!approvingGroup) return;
    setUploadingProof(true);
    setErr("");
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-payments");
    setUploadingProof(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setProofUrl(uploaded.url);
    verifyProof(approvingGroup, uploaded.url);
  }

  async function uploadShippingProof(file: File) {
    if (!approvingGroup) return;
    setUploadingShippingProof(true);
    setErr("");
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-payments");
    setUploadingShippingProof(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setShippingProofUrl(uploaded.url);
    verifyShippingProof(approvingGroup, uploaded.url);
  }

  async function requestAccountChange(groupId: string) {
    setBusyAccountGroup(groupId);
    await fetch(`/api/purchase-requests/group/${groupId}/request-account-change`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: accountChangeNote.trim() || undefined }),
    });
    setBusyAccountGroup(null);
    setRequestingAccountChangeFor(null);
    setAccountChangeNote("");
    load();
    router.refresh();
  }

  async function reject(groupId: string) {
    setBusyGroup(groupId);
    await fetch(`/api/purchase-requests/group/${groupId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", rejectReason: rejectReason.trim() || undefined }),
    });
    setBusyGroup(null);
    setRejectingGroup(null);
    setRejectReason("");
    load();
    router.refresh();
  }

  // Confirmado 2026-08-03: aprobar y pagar quedan en un solo paso — se
  // aprueba, y con el comprobante ya subido se registra el pago de una vez
  // (el del flete es opcional), en vez de tener que volver más tarde a
  // Finanzas para la mitad que faltaba.
  async function approveAndPay(groupId: string, payShipping: boolean) {
    const netAmount = netAmountFor(groupId);
    if (netAmount > 0) {
      if (!proofUrl) {
        setErr("Sube el comprobante de pago de la mercadería.");
        return;
      }
      if (!proofVerifyResult?.matches) {
        setErr("El comprobante de la mercadería todavía no está verificado — el monto debe coincidir con lo que corresponde pagar.");
        return;
      }
    }
    if (payShipping && shippingProofUrl && !shippingProofVerifyResult?.matches) {
      setErr("El comprobante del flete todavía no está verificado — el monto debe coincidir con lo que corresponde pagar.");
      return;
    }
    setBusyGroup(groupId);
    setErr("");
    const reviewRes = await fetch(`/api/purchase-requests/group/${groupId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    if (!reviewRes.ok) {
      setBusyGroup(null);
      const data = await reviewRes.json().catch(() => null);
      setErr(data?.error ?? "No se pudo aprobar.");
      return;
    }
    const payRes = await fetch(`/api/purchase-requests/group/${groupId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentProofUrl: proofUrl ?? undefined, paymentProofReceiptNumber: proofVerifyResult?.receiptNumber ?? null }),
    });
    if (!payRes.ok) {
      setBusyGroup(null);
      const data = await payRes.json().catch(() => null);
      setErr(`${data?.error ?? "No se pudo registrar el pago."} La solicitud ya quedó aprobada — termina de pagarla desde Finanzas.`);
      load();
      return;
    }
    if (payShipping && shippingProofUrl) {
      await fetch(`/api/purchase-requests/group/${groupId}/shipping-pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proofUrl: shippingProofUrl, proofReceiptNumber: shippingProofVerifyResult?.receiptNumber ?? null }),
      }).catch(() => null);
    }
    setBusyGroup(null);
    setApprovingGroup(null);
    setProofUrl(null);
    setProofVerifyResult(null);
    setShippingProofUrl(null);
    setShippingProofVerifyResult(null);
    load();
    router.refresh();
  }

  if (!rows) return <div className="text-steel text-[13px]">Cargando…</div>;
  if (rows.length === 0) return <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13.5px]">No hay solicitudes pendientes de aprobar.</div>;

  const groups = groupRows(rows);

  return (
    <div className="flex flex-col gap-2.5">
      {groups.map((g) => {
        const groupId = g[0].groupId;
        const total = g.reduce((s, r) => s + r.totalCost, 0);
        const justification = g.find((r) => r.justification)?.justification ?? null;
        const summary = buildValidationSummary(g);
        const canPayShippingNow = !g[0].shippingIncluded && g[0].shippingPaymentTiming === "WITH_PURCHASE";
        return (
          <div key={groupId} className="bg-surface border border-rule rounded-md p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-1.5">
              <div>
                {g.map((r) => (
                  <div key={r.id} className="text-[14px] font-bold">{r.catalogItem.name} · {r.quantity} un. — ${r.unitCost.toFixed(2)}/un.</div>
                ))}
                <div className="text-[11.5px] text-steel mt-0.5">{g[0].supplier.name}</div>
                <div className="text-[10px] text-steel-dim mt-0.5">
                  Solicitada por {actorName(g[0].requestedBy?.name)}
                  {g[0].attemptNumber > 1 && <span className="text-gold"> — {attemptLabel(g[0].attemptNumber)}</span>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                {justification && (
                  <button
                    type="button"
                    onClick={() => toggleHistory(groupId, g[0].catalogItemId)}
                    className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-red/15 text-red border border-red/40 rounded-full px-2.5 py-1 cursor-pointer hover:bg-red/25"
                  >
                    <LineChart size={11} />
                    Sobre el historial
                    <ChevronDown size={11} className={`transition-transform ${historyOpenGroup === groupId ? "rotate-180" : ""}`} />
                  </button>
                )}
                <div className="text-right">
                  {reservedTotalFor(groupId) > 0 && (
                    <>
                      <div className="text-[9px] font-semibold uppercase tracking-wide text-steel-dim">Total ${total.toFixed(2)} − crédito reservado ${reservedTotalFor(groupId).toFixed(2)}</div>
                      <div className="text-[9px] font-semibold uppercase tracking-wide text-steel">Neto a pagar</div>
                    </>
                  )}
                  {reservedTotalFor(groupId) === 0 && (
                    <div className="text-[9px] font-semibold uppercase tracking-wide text-steel">Total a pagar</div>
                  )}
                  <div className="font-display text-[22px] font-bold text-teal leading-tight">${netAmountFor(groupId).toFixed(2)}</div>
                </div>
              </div>
            </div>

            <div className={`flex items-start gap-1.5 rounded-md px-3 py-2 mb-2.5 text-[11.5px] ${summary.hasIssue ? "bg-red/10 text-red border border-red/30" : "bg-teal/10 text-teal border border-teal/30"}`}>
              {summary.hasIssue ? <AlertTriangle size={13} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={13} className="mt-0.5 shrink-0" />}
              <span>{summary.text}</span>
            </div>

            {historyOpenGroup === groupId && (
              <div className="bg-surface2 border border-rule rounded-md p-3 mb-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1.5">Historial de precio — todos los proveedores</div>
                {historyByCatalogItem[g[0].catalogItemId] === undefined || historyByCatalogItem[g[0].catalogItemId] === null ? (
                  <div className="text-steel text-[12px]">Cargando historial de precio…</div>
                ) : (
                  (() => {
                    const withPaid = historyByCatalogItem[g[0].catalogItemId]!
                      .map((s) => ({ s, paid: s.history.filter((p) => p.paidAt) }))
                      .filter((x) => x.paid.length > 0)
                      .sort((a, b) => a.paid[a.paid.length - 1].unitCost - b.paid[b.paid.length - 1].unitCost);

                    if (withPaid.length === 0) {
                      return <div className="text-steel text-[12px]">Todavía no hay pagos confirmados de este insumo con ningún proveedor.</div>;
                    }

                    const cheapestId = withPaid[0].s.supplierId;

                    return (
                      <div className="flex flex-col gap-2">
                        {withPaid.map(({ s, paid }) => {
                          const isCheapest = s.supplierId === cheapestId;
                          const isCurrent = s.supplierId === g[0].supplier.id;
                          const isOpen = openSupplierId === s.supplierId;
                          const latest = paid[paid.length - 1].unitCost;
                          const avgAll = paid.reduce((sum, p) => sum + p.unitCost, 0) / paid.length;
                          const visible = historyExpanded ? paid : paid.slice(-HISTORY_WINDOW);
                          const hiddenCount = paid.length - visible.length;
                          const costs = paid.map((p) => p.unitCost);
                          const min = Math.min(...costs);
                          const max = Math.max(...costs);
                          return (
                            <div key={s.supplierId} className={`rounded-md border ${isCheapest ? "border-teal/50 bg-teal/[0.06]" : "border-rule bg-surface"}`}>
                              <button
                                type="button"
                                className="w-full flex items-center gap-3 px-3 py-2.5 text-left cursor-pointer"
                                onClick={() => toggleSupplierRow(s.supplierId)}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[13px] font-semibold truncate">{s.supplierName}</span>
                                    {isCheapest && (
                                      <span className="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wide bg-teal/15 text-teal border border-teal/40 rounded-full px-2 py-0.5">
                                        <Award size={9} /> Más barato
                                      </span>
                                    )}
                                    {isCurrent && <span className="text-[9.5px] font-bold uppercase tracking-wide text-red">Esta solicitud</span>}
                                  </div>
                                  <div className="text-[11px] text-steel mt-0.5">
                                    {paid.length} {paid.length === 1 ? "pago" : "pagos"} · promedio ${avgAll.toFixed(2)}
                                  </div>
                                </div>
                                <div className="text-right shrink-0">
                                  <div className={`text-[16px] font-bold ${isCheapest ? "text-teal" : "text-ink"}`}>${latest.toFixed(2)}</div>
                                  <div className="text-[10px] text-steel">último pago</div>
                                </div>
                                <ChevronDown size={15} className={`text-steel shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                              </button>
                              {isOpen && (
                                <div className="px-3 pb-3.5 pt-1 border-t border-rule">
                                  <PriceTrendChart points={visible} />
                                  {(hiddenCount > 0 || (historyExpanded && paid.length > HISTORY_WINDOW)) && (
                                    <div className="flex justify-center mt-1">
                                      {hiddenCount > 0 ? (
                                        <button type="button" onClick={() => setHistoryExpanded(true)} className="text-[11px] text-teal font-semibold cursor-pointer">
                                          Ver {hiddenCount} {hiddenCount === 1 ? "pago anterior" : "pagos anteriores"}
                                        </button>
                                      ) : (
                                        <button type="button" onClick={() => setHistoryExpanded(false)} className="text-[11px] text-steel font-semibold cursor-pointer">
                                          Ocultar pagos anteriores
                                        </button>
                                      )}
                                    </div>
                                  )}
                                  <div className="grid grid-cols-3 gap-2 mt-2">
                                    <div className="bg-cloud rounded p-2 text-center">
                                      <div className="text-[8.5px] uppercase text-steel">Más bajo</div>
                                      <div className="text-[12.5px] font-bold text-green">${min.toFixed(2)}</div>
                                    </div>
                                    <div className="bg-cloud rounded p-2 text-center">
                                      <div className="text-[8.5px] uppercase text-steel">Promedio</div>
                                      <div className="text-[12.5px] font-bold text-teal">${avgAll.toFixed(2)}</div>
                                    </div>
                                    <div className="bg-cloud rounded p-2 text-center">
                                      <div className="text-[8.5px] uppercase text-steel">Más alto</div>
                                      <div className="text-[12.5px] font-bold text-red">${max.toFixed(2)}</div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()
                )}
              </div>
            )}

            <div className="flex items-center gap-2 mb-2.5">
              <a href={g[0].quoteImageUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[11.5px] text-blue font-semibold cursor-pointer">
                {isPdf(g[0].quoteImageUrl) ? <FileText size={13} /> : <img src={g[0].quoteImageUrl} alt="" className="w-6 h-6 rounded object-cover border border-rule" />}
                Ver cotización
              </a>
              {g[0].purchaseOrderUrl && (
                <a href={g[0].purchaseOrderUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[11.5px] text-blue font-semibold cursor-pointer">
                  {isPdf(g[0].purchaseOrderUrl) ? <FileText size={13} /> : <img src={g[0].purchaseOrderUrl} alt="" className="w-6 h-6 rounded object-cover border border-rule" />}
                  Ver orden de compra
                </a>
              )}
            </div>

            {g[0].bankAccountChangeRequestedAt ? (
              <div className="flex items-start gap-1.5 bg-gold/10 border border-gold/35 rounded-md px-3 py-2 mb-2.5 text-[11.5px]" style={{ color: "#D9A441" }}>
                <Landmark size={13} className="mt-0.5 shrink-0" />
                <span>
                  Esperando que {actorName(g[0].requestedBy?.name)} cambie la cuenta bancaria{g[0].bankAccountChangeNote ? ` — "${g[0].bankAccountChangeNote}"` : ""}.
                </span>
              </div>
            ) : g[0].bankAccount ? (
              <div className="bg-cloud border border-rule rounded-md px-3 py-2.5 mb-2.5">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel mb-1.5">
                  <Landmark size={12} /> Cuenta bancaria para pagar
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2.5 gap-y-0.5 text-[11.5px] mb-2">
                  <div><span className="text-steel">Banco: </span><span className="font-semibold">{g[0].bankAccount.bankName}</span></div>
                  <div><span className="text-steel">Tipo: </span><span className="font-semibold">{g[0].bankAccount.bankAccountType}</span></div>
                  <div><span className="text-steel">N°: </span><span className="font-semibold break-all">{g[0].bankAccount.bankAccountNumber}</span></div>
                  <div><span className="text-steel">Titular: </span><span className="font-semibold">{g[0].bankAccount.bankAccountHolder}</span></div>
                  {g[0].bankAccount.holderIdType && (
                    <div><span className="text-steel">{g[0].bankAccount.holderIdType === "RUC" ? "RUC" : "CI"}: </span><span className="font-semibold break-all">{g[0].bankAccount.holderIdNumber}</span></div>
                  )}
                </div>
                {requestingAccountChangeFor === groupId ? (
                  <div>
                    <textarea
                      className="w-full rounded border border-rule px-2.5 py-1.5 text-[11.5px] mb-1.5"
                      rows={2}
                      placeholder="¿Por qué hace falta cambiarla? (opcional, ej. el banco no permite la transferencia)"
                      value={accountChangeNote}
                      onChange={(e) => setAccountChangeNote(e.target.value)}
                    />
                    <div className="flex items-center gap-2">
                      <button type="button" disabled={busyAccountGroup === groupId} className="rounded border border-gold/50 px-2.5 py-1 text-[11px] font-semibold cursor-pointer disabled:opacity-60" style={{ color: "#D9A441" }} onClick={() => requestAccountChange(groupId)}>
                        Confirmar aviso
                      </button>
                      <button type="button" className="text-steel text-[11px] cursor-pointer" onClick={() => { setRequestingAccountChangeFor(null); setAccountChangeNote(""); }}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="text-[11px] text-steel underline cursor-pointer" onClick={() => setRequestingAccountChangeFor(groupId)}>
                    Esta cuenta no sirvió — pedir que la cambien
                  </button>
                )}
              </div>
            ) : (
              <div className="text-[11px] text-steel mb-2.5">Sin cuenta bancaria elegida (el proveedor solo tenía una en ese momento).</div>
            )}

            {justification && <div className="text-[12px] text-steel mb-2.5">Justificación: &quot;{justification}&quot;</div>}

            {rejectingGroup === groupId ? (
              <div>
                <textarea className="w-full rounded border border-rule px-2.5 py-2 text-[12.5px] mb-2" rows={2} placeholder="Motivo del rechazo (opcional)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                <div className="flex items-center gap-2">
                  <button type="button" disabled={busyGroup === groupId} className="rounded border border-red bg-red px-3 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => reject(groupId)}>
                    Confirmar rechazo
                  </button>
                  <button type="button" className="text-steel text-[12px] cursor-pointer" onClick={() => setRejectingGroup(null)}>Cancelar</button>
                </div>
              </div>
            ) : approvingGroup === groupId ? (
              <div className="bg-surface2 border border-rule rounded-md p-3">
                {reservedTotalFor(groupId) > 0 && (
                  <div className="flex items-center gap-1.5 text-[12px] text-teal bg-teal/10 border border-teal/30 rounded-md px-3 py-2 mb-3">
                    <CheckCircle2 size={13} /> Crédito reservado con {g[0].supplier.name} aplicado: ${reservedTotalFor(groupId).toFixed(2)} — neto a transferir: ${netAmountFor(groupId).toFixed(2)}
                  </div>
                )}
                {netAmountFor(groupId) === 0 ? (
                  <div className="flex items-center gap-2 text-[12px] text-teal mb-1">
                    <CheckCircle2 size={13} /> El crédito cubre el total — no hace falta comprobante de mercadería.
                  </div>
                ) : (
                  <>
                <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Comprobante de pago — mercadería</label>
                {proofUrl ? (
                  <div className="mb-3">
                    <div className="flex items-center gap-2 text-[12px] mb-1">
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
                          ? `Verificado — coincide con lo que corresponde pagar (${proofVerifyResult.readAmount?.toFixed(2)})`
                          : proofVerifyResult && proofVerifyResult.readAmount !== null
                          ? `No coincide — el comprobante dice $${proofVerifyResult.readAmount.toFixed(2)}, revisa antes de continuar`
                          : proofVerifyResult
                          ? "No se pudo leer el monto — sube una imagen más clara"
                          : "Comprobante subido"}
                      </span>
                      <button type="button" className="text-steel ml-1 cursor-pointer" onClick={() => { setProofUrl(null); setProofVerifyResult(null); }}>Cambiar</button>
                    </div>
                  </div>
                ) : (
                  <div className="mb-3">
                    <label
                      tabIndex={0}
                      onPaste={onPasteProof}
                      onMouseEnter={onPasteProofHoverIn}
                      onMouseLeave={onPasteProofHoverOut}
                      className="flex items-center justify-center gap-2 border-[1.5px] border-dashed border-rule rounded-md py-2.5 cursor-pointer text-[12px] text-steel hover:border-teal focus:border-teal focus:outline-none"
                    >
                      {uploadingProof ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={14} />}
                      Subir o pegar foto (pasa el mouse y Ctrl+V)
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadProof(e.target.files[0])} />
                    </label>
                    <label className="flex items-center justify-center gap-1.5 mt-1.5 text-[10.5px] text-steel cursor-pointer hover:text-teal">
                      <FileText size={10.5} /> ¿Es un PDF? Subir documento
                      <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && uploadProof(e.target.files[0])} />
                    </label>
                  </div>
                )}
                  </>
                )}

                {canPayShippingNow && (
                  <>
                    <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">
                      Comprobante de pago — flete <span className="text-steel-dim normal-case font-normal">(opcional)</span>
                    </label>
                    {shippingProofUrl ? (
                      <div className="mb-3">
                        <div className="flex items-center gap-2 text-[12px] mb-1">
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
                              ? `Verificado — coincide con el flete (${shippingProofVerifyResult.readAmount?.toFixed(2)})`
                              : shippingProofVerifyResult && shippingProofVerifyResult.readAmount !== null
                              ? `No coincide — el comprobante dice $${shippingProofVerifyResult.readAmount.toFixed(2)}, revisa antes de continuar`
                              : shippingProofVerifyResult
                              ? "No se pudo leer el monto — sube una imagen más clara"
                              : "Comprobante subido"}
                          </span>
                          <button type="button" className="text-steel ml-1 cursor-pointer" onClick={() => { setShippingProofUrl(null); setShippingProofVerifyResult(null); }}>Cambiar</button>
                        </div>
                      </div>
                    ) : (
                      <div className="mb-3">
                        <label
                          tabIndex={0}
                          onPaste={onPasteShippingProof}
                          onMouseEnter={onPasteShippingProofHoverIn}
                          onMouseLeave={onPasteShippingProofHoverOut}
                          className="flex items-center justify-center gap-2 border-[1.5px] border-dashed border-rule rounded-md py-2.5 cursor-pointer text-[12px] text-steel hover:border-teal focus:border-teal focus:outline-none"
                        >
                          {uploadingShippingProof ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={14} />}
                          Subir o pegar foto (pasa el mouse y Ctrl+V)
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadShippingProof(e.target.files[0])} />
                        </label>
                        <label className="flex items-center justify-center gap-1.5 mt-1.5 text-[10.5px] text-steel cursor-pointer hover:text-teal">
                          <FileText size={10.5} /> ¿Es un PDF? Subir documento
                          <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && uploadShippingProof(e.target.files[0])} />
                        </label>
                      </div>
                    )}
                  </>
                )}

                {err && <div className="text-red text-[12px] mb-2.5">{err}</div>}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={
                      busyGroup === groupId ||
                      (netAmountFor(groupId) > 0 && (!proofUrl || proofVerifying || !proofVerifyResult?.matches)) ||
                      (!!shippingProofUrl && (shippingProofVerifying || !shippingProofVerifyResult?.matches))
                    }
                    className="rounded border border-green bg-green px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
                    onClick={() => approveAndPay(groupId, canPayShippingNow)}
                  >
                    Aprobar y confirmar pago
                  </button>
                  <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={() => { setApprovingGroup(null); setProofUrl(null); setProofVerifyResult(null); setShippingProofUrl(null); setShippingProofVerifyResult(null); setErr(""); }}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button type="button" disabled={busyGroup === groupId} className="rounded border border-green bg-green px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => { setApprovingGroup(groupId); setProofUrl(null); setProofVerifyResult(null); setShippingProofUrl(null); setShippingProofVerifyResult(null); setErr(""); }}>
                  Aprobar
                </button>
                <button type="button" disabled={busyGroup === groupId} className="rounded border border-rule px-3.5 py-1.5 text-[12.5px] font-semibold text-steel cursor-pointer" onClick={() => setRejectingGroup(groupId)}>
                  Rechazar
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
