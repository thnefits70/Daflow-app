"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, Link2, CheckCircle2, AlertTriangle, Sparkles, Copy, Check } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { formatDateTime } from "@/lib/formatDateTime";
import { useFormDraft, clearFormDraft } from "@/lib/useFormDraft";

type SupplierOption = { id: string; name: string; paymentMode: "PREPAGO" | "CREDITO" };

type PendingItem = {
  id: string;
  requestNumber: number | null;
  productName: string;
  quantity: number;
  totalCost: number;
  grossCost: number;
  creditDeduction: number;
  requestedAt: string;
  approvedByName: string | null;
  approvedAt: string | null;
  reviewedByName: string | null;
  receivedAt: string | null;
  buyerDebtConfirmedByName: string | null;
  buyerDebtConfirmedAt: string | null;
};
type InTransitItem = { id: string; requestNumber: number | null; productName: string; quantity: number; totalCost: number; requestedAt: string; statusLabel: string };
type PendingExcessItem = {
  id: string;
  requestId: string;
  requestNumber: number | null;
  productName: string;
  excessQty: number;
  amount: number;
  excessConfirmedAt: string | null;
  excessConfirmedByName: string | null;
};
type DisputedItem = {
  id: string;
  requestNumber: number | null;
  productName: string;
  quantity: number;
  wouldBeValue: number;
  damagedQty: number;
  incompleteQty: number;
  differentQty: number;
  missingQty: number;
  requestedAt: string;
  approvedByName: string | null;
  reviewedByName: string | null;
  reportedByName: string | null;
  damageDescriptions: string[];
  damageConfirmedByName: string | null;
  damageConfirmPending: boolean;
  paymentOnHold: boolean;
};
type Transfer = {
  id: string;
  amount: number;
  transferDate: string;
  bankNameDestino: string;
  accountDestino: string;
  bankNameOrigen: string;
  accountOrigen: string;
  comprobanteNumber: string;
  transactionCost: number | null;
  iva: number | null;
  proofUrl: string;
};
type Payment = {
  id: string;
  code: string;
  totalAmount: number;
  closedAt: string | null;
  aiReviewSummary: string | null;
  aiReviewOk: boolean | null;
  aiReviewAt: string | null;
  requests: { id: string; quantity: number; totalCost: number; creditDeduction: number; catalogItem: { name: string } }[];
  excessReports: { id: string; excessQty: number; amount: number; request: { requestNumber: number | null; catalogItem: { name: string } } }[];
  transfers: Transfer[];
};

type Summary = {
  supplier: {
    id: string;
    name: string;
    paymentMode: string;
    hasPublicLink: boolean;
    publicLedgerToken: string | null;
    publicLedgerTokenCreatedAt: string | null;
    publicShippingToken: string | null;
    publicShippingTokenCreatedAt: string | null;
    bankAccounts: { id: string; bankName: string; bankAccountNumber: string; bankAccountHolder: string }[];
  };
  balance: number;
  pendingItems: PendingItem[];
  pendingExcessItems: PendingExcessItem[];
  disputedItems: DisputedItem[];
  inTransitItems: InTransitItem[];
  openPayments: Payment[];
  closedPayments: Payment[];
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

type TransferFormData = {
  amount: string; transferDate: string; bankNameDestino: string; accountDestino: string;
  bankNameOrigen: string; accountOrigen: string; comprobanteNumber: string; transactionCost: string; iva: string; proofUrl: string;
};
function isTransferFormDraftEmpty(d: TransferFormData) {
  return !d.amount.trim() && !d.bankNameDestino.trim() && !d.accountDestino.trim() && !d.bankNameOrigen.trim() && !d.accountOrigen.trim() && !d.comprobanteNumber.trim() && !d.proofUrl.trim();
}

// Guardado automático de la transferencia en progreso de una tanda —
// componente aparte porque puede haber varias tandas abiertas a la vez y
// un hook no se puede llamar dentro de un .map(). No renderiza nada, solo
// mantiene sincronizado el borrador con transferForms del padre.
function TransferDraftSync({ paymentId, f, onRestore }: { paymentId: string; f: TransferFormData; onRestore: (d: TransferFormData) => void }) {
  useFormDraft<TransferFormData>(
    `supplierDebtTransfer:${paymentId}`,
    f,
    onRestore,
    isTransferFormDraftEmpty,
    "Transferencia a proveedor sin terminar de registrar",
    "/area/workspace?tab=compras"
  );
  return null;
}

// Confirmado 2026-09-08 (Fase 1, proveedores con crédito): pestaña
// admin-only — saldo, tandas de pago, y el enlace público de solo lectura
// para un proveedor de crédito (hoy solo CHEN). La IA revisa cada tanda
// antes de cerrarla, pero nunca bloquea — la decisión de pagar es siempre
// del admin.
export function SupplierDebtPanel() {
  const [suppliers, setSuppliers] = useState<SupplierOption[] | null>(null);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedExcess, setSelectedExcess] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedShippingLink, setCopiedShippingLink] = useState(false);
  const [transferForms, setTransferForms] = useState<Record<string, { amount: string; transferDate: string; bankNameDestino: string; accountDestino: string; bankNameOrigen: string; accountOrigen: string; comprobanteNumber: string; transactionCost: string; iva: string; proofUrl: string }>>({});
  const [uploadingProof, setUploadingProof] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadPaymentId = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/purchase-suppliers")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: SupplierOption[]) => {
        const credit = rows.filter((s) => s.paymentMode === "CREDITO");
        setSuppliers(credit);
        if (credit.length > 0) setSupplierId(credit[0].id);
      })
      .catch(() => setSuppliers([]));
  }, []);

  function load() {
    if (!supplierId) return;
    fetch(`/api/supplier-debt/${supplierId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setSummary)
      .catch(() => setSummary(null));
  }

  useEffect(load, [supplierId]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectedExcess(id: string) {
    setSelectedExcess((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createPayment() {
    if (!supplierId || (selected.size === 0 && selectedExcess.size === 0)) return;
    setErr("");
    setBusy(true);
    const res = await fetch(`/api/supplier-debt/${supplierId}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestIds: [...selected], excessReportIds: [...selectedExcess] }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErr(d.error ?? "No se pudo crear la tanda.");
      return;
    }
    setSelected(new Set());
    setSelectedExcess(new Set());
    load();
  }

  function blankTransferForm() {
    return {
      amount: "",
      transferDate: new Date().toISOString().slice(0, 10),
      bankNameDestino: "",
      accountDestino: "",
      bankNameOrigen: "",
      accountOrigen: "",
      comprobanteNumber: "",
      transactionCost: "",
      iva: "",
      proofUrl: "",
    };
  }

  function transferForm(paymentId: string) {
    return transferForms[paymentId] ?? blankTransferForm();
  }

  function setTransferField(paymentId: string, field: string, value: string) {
    setTransferForms((prev) => ({ ...prev, [paymentId]: { ...transferForm(paymentId), [field]: value } }));
  }

  function setTransferFormBulk(paymentId: string, data: TransferFormData) {
    setTransferForms((prev) => ({ ...prev, [paymentId]: data }));
  }

  async function uploadProof(file: File) {
    const paymentId = pendingUploadPaymentId.current;
    if (!paymentId) return;
    setUploadingProof(paymentId);
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "supplier-debt-transfers");
    setUploadingProof(null);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setTransferField(paymentId, "proofUrl", uploaded.url);
  }

  async function addTransfer(paymentId: string) {
    const f = transferForm(paymentId);
    if (!f.amount || !f.transferDate || !f.bankNameDestino || !f.accountDestino || !f.bankNameOrigen || !f.accountOrigen || !f.comprobanteNumber || !f.proofUrl) {
      setErr("Completa todos los datos de la transferencia, incluida la captura.");
      return;
    }
    setErr("");
    setBusy(true);
    const res = await fetch(`/api/supplier-debt/payments/${paymentId}/transfers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Number(f.amount),
        transferDate: f.transferDate,
        bankNameDestino: f.bankNameDestino,
        accountDestino: f.accountDestino,
        bankNameOrigen: f.bankNameOrigen,
        accountOrigen: f.accountOrigen,
        comprobanteNumber: f.comprobanteNumber,
        transactionCost: f.transactionCost ? Number(f.transactionCost) : undefined,
        iva: f.iva ? Number(f.iva) : undefined,
        proofUrl: f.proofUrl,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErr(d.error ?? "No se pudo registrar la transferencia.");
      return;
    }
    setTransferForms((prev) => ({ ...prev, [paymentId]: blankTransferForm() }));
    clearFormDraft(`supplierDebtTransfer:${paymentId}`);
    load();
  }

  async function runReview(paymentId: string) {
    setErr("");
    setBusy(true);
    const res = await fetch(`/api/supplier-debt/payments/${paymentId}/review`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErr(d.error ?? "No se pudo revisar con IA.");
      return;
    }
    load();
  }

  async function closePayment(paymentId: string) {
    setErr("");
    setBusy(true);
    const res = await fetch(`/api/supplier-debt/payments/${paymentId}/close`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErr(d.error ?? "No se pudo cerrar la tanda.");
      return;
    }
    load();
  }

  // Confirmado 2026-09-09: el enlace de CHEN nunca debe mostrar el dominio
  // real de DAFLOW — se compró un dominio propio para esto
  // (dunxingchen.cc) y se usa siempre, sin importar desde qué dominio esté
  // navegando quien lo ve.
  function ledgerUrl(token: string) {
    const origin = process.env.NEXT_PUBLIC_SUPPLIER_LEDGER_DOMAIN
      ? `https://${process.env.NEXT_PUBLIC_SUPPLIER_LEDGER_DOMAIN}`
      : window.location.origin;
    return `${origin}/proveedor-ledger/${token}`;
  }

  // Confirmado 2026-09-17: mismo dominio propio de CHEN (dunxingchen.cc),
  // segundo enlace independiente — solo abre "lo que falta enviar", nunca
  // el saldo. Pensado para que el proveedor se lo pase a su propio equipo.
  function shippingUrl(token: string) {
    const origin = process.env.NEXT_PUBLIC_SUPPLIER_LEDGER_DOMAIN
      ? `https://${process.env.NEXT_PUBLIC_SUPPLIER_LEDGER_DOMAIN}`
      : window.location.origin;
    return `${origin}/proveedor-ledger/envios/${token}`;
  }

  async function generateLink() {
    if (!supplierId) return;
    setErr("");
    setBusy(true);
    const res = await fetch(`/api/supplier-debt/${supplierId}/public-link`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      setErr("No se pudo generar el enlace.");
      return;
    }
    // Confirmado 2026-09-15: ya no hace falta guardar el token devuelto acá
    // aparte — load() vuelve a traer el resumen, que ahora incluye
    // publicLedgerToken tal cual, así que el enlace persistente de abajo se
    // actualiza solo.
    load();
  }

  async function generateShippingLink() {
    if (!supplierId) return;
    setErr("");
    setBusy(true);
    const res = await fetch(`/api/supplier-debt/${supplierId}/shipping-link`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      setErr("No se pudo generar el enlace.");
      return;
    }
    load();
  }

  async function copyLink(url: string, which: "ledger" | "shipping" = "ledger") {
    try {
      await navigator.clipboard.writeText(url);
      if (which === "shipping") {
        setCopiedShippingLink(true);
        setTimeout(() => setCopiedShippingLink(false), 2000);
      } else {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      }
    } catch {
      // Confirmado 2026-09-15: si el navegador bloquea el portapapeles (ej.
      // sin HTTPS o sin permiso), el enlace ya está visible en pantalla para
      // copiarlo a mano — no hace falta mostrar un error.
    }
  }

  if (suppliers === null) return <div className="text-steel text-[13px]">Cargando…</div>;
  if (suppliers.length === 0) {
    return (
      <div className="text-steel text-[13.5px]">
        Todavía no hay ningún proveedor marcado como crédito. Márcalo en el directorio de Proveedores para que aparezca acá.
      </div>
    );
  }

  return (
    <div>
      {suppliers.length > 1 && (
        <select
          className="mb-4 rounded border border-rule bg-surface px-2.5 py-1.5 text-[13px] text-ink"
          value={supplierId ?? ""}
          onChange={(e) => setSupplierId(e.target.value)}
        >
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}

      {err && <div className="mb-3 text-red text-[12.5px]">{err}</div>}

      {!summary ? (
        <div className="text-steel text-[13px]">Cargando…</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4 mb-5">
            <div className="bg-surface border border-rule rounded-md px-4 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-steel">Saldo actual a pagar</div>
              <div className="text-[18px] font-bold text-ink">{money(summary.balance)}</div>
              {/* Confirmado 2026-09-22, pedido explícito del usuario: la cuenta
                  arranca de cero desde esta fecha (SUPPLIER_DEBT_TRACKING_START). */}
              <div className="text-[10.5px] text-steel">Solo solicitudes desde el lun 21/9/2026</div>
            </div>
            <div>
              {summary.supplier.publicLedgerToken ? (
                // Confirmado 2026-09-15, pedido explícito del usuario: quiere
                // poder ver siempre el enlace activo, sin tener que
                // regenerarlo (lo que además invalidaría el que CHEN ya tiene
                // guardado).
                <div className="text-[12px] text-steel">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Link2 size={12} />
                    <span>
                      Enlace activo para {summary.supplier.name}
                      {summary.supplier.publicLedgerTokenCreatedAt && ` — generado ${formatDateTime(summary.supplier.publicLedgerTokenCreatedAt)}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 rounded border border-rule bg-cloud px-2.5 py-1.5">
                    <span className="font-mono text-[11.5px] text-ink break-all">{ledgerUrl(summary.supplier.publicLedgerToken)}</span>
                    <button
                      type="button"
                      className="shrink-0 flex items-center gap-1 text-blue cursor-pointer"
                      onClick={() => copyLink(ledgerUrl(summary.supplier.publicLedgerToken!))}
                      title="Copiar enlace"
                    >
                      {copiedLink ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                  <button type="button" className="underline decoration-dotted cursor-pointer mt-1" onClick={generateLink} disabled={busy}>
                    regenerar (invalida este enlace)
                  </button>
                </div>
              ) : summary.supplier.hasPublicLink ? (
                // Enlace generado ANTES de este cambio (solo hash, ya
                // irrecuperable) — sigue funcionando para quien ya lo tenga,
                // pero acá no se puede volver a mostrar.
                <div className="text-[12px] text-steel">
                  <Link2 size={12} className="inline mr-1" />
                  Enlace generado {summary.supplier.publicLedgerTokenCreatedAt ? formatDateTime(summary.supplier.publicLedgerTokenCreatedAt) : ""} — de un formato anterior, ya no se puede volver a mostrar acá.{" "}
                  <button type="button" className="underline decoration-dotted cursor-pointer" onClick={generateLink} disabled={busy}>
                    regenerar para poder verlo siempre
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded border border-rule bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-ink cursor-pointer disabled:opacity-60"
                  onClick={generateLink}
                  disabled={busy}
                >
                  <Link2 size={13} /> Generar enlace público para {summary.supplier.name}
                </button>
              )}
            </div>
            <div>
              {/* Confirmado 2026-09-17, pedido explícito del usuario: un
                  segundo enlace, aparte del de arriba, para que el proveedor
                  se lo pase a su propio equipo de despacho — solo muestra
                  "lo que falta enviar", nunca el saldo ni la plata. */}
              {summary.supplier.publicShippingToken ? (
                <div className="text-[12px] text-steel">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Link2 size={12} />
                    <span>
                      Enlace solo-envíos (para el equipo de {summary.supplier.name})
                      {summary.supplier.publicShippingTokenCreatedAt && ` — generado ${formatDateTime(summary.supplier.publicShippingTokenCreatedAt)}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 rounded border border-rule bg-cloud px-2.5 py-1.5">
                    <span className="font-mono text-[11.5px] text-ink break-all">{shippingUrl(summary.supplier.publicShippingToken)}</span>
                    <button
                      type="button"
                      className="shrink-0 flex items-center gap-1 text-blue cursor-pointer"
                      onClick={() => copyLink(shippingUrl(summary.supplier.publicShippingToken!), "shipping")}
                      title="Copiar enlace"
                    >
                      {copiedShippingLink ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                  <button type="button" className="underline decoration-dotted cursor-pointer mt-1" onClick={generateShippingLink} disabled={busy}>
                    regenerar (invalida este enlace)
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded border border-rule bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-ink cursor-pointer disabled:opacity-60"
                  onClick={generateShippingLink}
                  disabled={busy}
                >
                  <Link2 size={13} /> Generar enlace "solo envíos" para el equipo de {summary.supplier.name}
                </button>
              )}
            </div>
          </div>

          <div className="mb-6">
            <h3 className="mb-2 text-[13px] font-semibold text-ink">Confirmado, pendiente de pago</h3>
            {summary.pendingItems.length === 0 && summary.pendingExcessItems.length === 0 ? (
              <p className="text-steel text-[13px]">No hay nada pendiente por ahora.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {summary.pendingExcessItems.map((i) => (
                  // Confirmado 2026-09-21, pedido explícito del usuario: el
                  // excedente (llegó más de lo pedido) SÍ se le paga a Chen,
                  // al mismo costo unitario de la solicitud que lo originó —
                  // se muestra anclado a esa solicitud (SC-XXX), nunca como
                  // una compra aparte.
                  <label key={`excess-${i.id}`} className="flex flex-col gap-1.5 bg-gold/5 border border-gold/30 rounded-md px-3 py-2 text-[13px] cursor-pointer">
                    <div className="flex items-center gap-2.5">
                      <input type="checkbox" checked={selectedExcess.has(i.id)} onChange={() => toggleSelectedExcess(i.id)} />
                      <span className="flex-1">
                        Excedente — {i.productName} × {i.excessQty} un. de más
                        {i.requestNumber != null && <span className="text-steel"> — Solicitud SC-{String(i.requestNumber).padStart(3, "0")}</span>}
                      </span>
                      <span className="font-semibold tabular-nums">{money(i.amount)}</span>
                    </div>
                    <div className="ml-6 flex flex-col gap-0.5 text-[11.5px] text-steel">
                      <span>
                        Excedente confirmado por (Bryan): <span className="font-medium">{i.excessConfirmedByName ?? "admin"}</span>
                        {i.excessConfirmedAt && <> — {formatDateTime(i.excessConfirmedAt)}</>}
                      </span>
                    </div>
                  </label>
                ))}
                {summary.pendingItems.map((i) => (
                  <label key={i.id} className="flex flex-col gap-1.5 bg-surface border border-rule rounded-md px-3 py-2 text-[13px] cursor-pointer">
                    <div className="flex items-center gap-2.5">
                      <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggleSelected(i.id)} />
                      <span className="flex-1">
                        {i.productName} × {i.quantity}{" "}
                        <span className="text-steel">— {formatDateTime(i.requestedAt)}</span>
                      </span>
                      <span className="font-semibold tabular-nums">{money(i.totalCost)}</span>
                    </div>
                    {/* Confirmado 2026-09-22, pedido explícito del usuario: si CHEN
                        aceptó descontar lo dañado en vez de reponerlo, se le paga solo
                        lo bueno — se muestra de dónde sale el monto. */}
                    {i.creditDeduction > 0 && (
                      <div className="ml-6 text-[11.5px] text-gold">
                        Valor del pedido {money(i.grossCost)} − descuento por mercadería dañada {money(i.creditDeduction)}
                      </div>
                    )}
                    {/* Confirmado 2026-09-18, pedido explícito del usuario: quiere ver
                        quién firmó cada visto bueno, con fecha y hora exacta, antes de
                        armar la tanda de pago — sobre todo el de Daniel (llegó a bodega)
                        y el de Bryan (él sí autorizó esta compra a CHEN). */}
                    <div className="ml-6 flex flex-col gap-0.5 text-[11.5px] text-steel">
                      <span>
                        Compra aprobada por: <span className="font-medium">{i.approvedByName ?? "admin"}</span>
                        {i.approvedAt && <> — {formatDateTime(i.approvedAt)}</>}
                      </span>
                      <span>
                        Recepción confirmada por (Daniel/Inventario): <span className="font-medium">{i.reviewedByName ?? "admin"}</span>
                        {i.receivedAt && <> — {formatDateTime(i.receivedAt)}</>}
                      </span>
                      <span>
                        Deuda confirmada por (Bryan): <span className="font-medium">{i.buyerDebtConfirmedByName ?? "admin"}</span>
                        {i.buyerDebtConfirmedAt && <> — {formatDateTime(i.buyerDebtConfirmedAt)}</>}
                      </span>
                    </div>
                  </label>
                ))}
                <button
                  type="button"
                  className="mt-1 w-fit rounded border border-blue bg-blue px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
                  disabled={selected.size + selectedExcess.size === 0 || busy}
                  onClick={createPayment}
                >
                  Crear tanda con {selected.size + selectedExcess.size} ítem{selected.size + selectedExcess.size === 1 ? "" : "s"} seleccionado{selected.size + selectedExcess.size === 1 ? "" : "s"}
                </button>
              </div>
            )}
          </div>

          {/* Confirmado 2026-09-15, pedido explícito del usuario: quiere ver
              TODO lo que tiene con este proveedor, de principio a fin — no
              solo lo pagable y lo en disputa. Un pedido en camino (aprobado
              pero sin recibir, o recibido pero sin las dos confirmaciones
              todavía) antes no aparecía en ningún lado de esta pantalla. */}
          {summary.inTransitItems.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-2 text-[13px] font-semibold text-ink">En camino — todavía no listo para pagar</h3>
              <div className="flex flex-col gap-1.5">
                {summary.inTransitItems.map((i) => (
                  <div key={i.id} className="bg-surface border border-rule rounded-md px-3 py-2 text-[13px]">
                    <div className="flex justify-between">
                      <span>{i.productName} × {i.quantity}</span>
                      <span className="font-semibold tabular-nums text-steel">{money(i.totalCost)}</span>
                    </div>
                    <div className="text-[11.5px] text-steel mt-0.5">
                      {i.statusLabel} — {formatDateTime(i.requestedAt)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {summary.disputedItems.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-2 text-[13px] font-semibold text-ink flex items-center gap-1.5">
                <AlertTriangle size={13} className="text-gold" /> En disputa — no se puede pagar hasta resolverse
              </h3>
              <div className="flex flex-col gap-1.5">
                {summary.disputedItems.map((i) => (
                  <div key={i.id} className="bg-gold/5 border border-gold/30 rounded-md px-3 py-2 text-[13px]">
                    <div className="flex justify-between">
                      <span>{i.productName} × {i.quantity}</span>
                      <span className="font-semibold tabular-nums text-steel">{money(i.wouldBeValue)} si se resuelve</span>
                    </div>
                    <div className="text-[11.5px] text-steel mt-0.5">
                      {[i.missingQty > 0 ? `${i.missingQty} faltantes` : null, i.damagedQty > 0 ? `${i.damagedQty} dañadas` : null, i.incompleteQty > 0 ? `${i.incompleteQty} incompletas` : null, i.differentQty > 0 ? `${i.differentQty} distintas` : null]
                        .filter(Boolean)
                        .join(", ")}
                      {/* Confirmado 2026-09-22: la parte buena ya entró a bodega,
                          pero se retiene el pago del pedido entero hasta que el
                          proveedor reponga (o acepte descontar) lo que llegó mal. */}
                      {i.paymentOnHold && " — la parte buena ya llegó; pago retenido hasta que el proveedor reponga lo que llegó mal"}
                    </div>
                    {i.damageDescriptions.map((d, idx) => (
                      <div key={idx} className="text-[12px] text-ink mt-0.5 whitespace-pre-line">
                        Motivo: {d}
                      </div>
                    ))}
                    <div className="text-[11.5px] text-steel mt-0.5">
                      Compra aprobada por {i.approvedByName ?? "—"} · Recibió {i.reviewedByName ?? "—"} · Reportó {i.reportedByName ?? "—"} · Daño
                      confirmado por:{" "}
                      {i.damageConfirmPending ? (
                        <span className="font-medium text-gold">pendiente de Daniel</span>
                      ) : (
                        <span className="font-medium text-ink">{i.damageConfirmedByName}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {summary.openPayments.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-2 text-[13px] font-semibold text-ink">Tandas en curso</h3>
              {summary.openPayments.map((p) => {
                const f = transferForm(p.id);
                const transfersTotal = p.transfers.reduce((s, t) => s + t.amount, 0);
                return (
                  <div key={p.id} className="bg-surface border border-rule rounded-md p-3.5 mb-3">
                    <TransferDraftSync paymentId={p.id} f={f} onRestore={(d) => setTransferFormBulk(p.id, d)} />
                    <div className="flex justify-between mb-2">
                      <span className="font-semibold text-[13.5px]">{p.code}</span>
                      <span className="tabular-nums text-[13.5px]">{money(p.totalAmount)}</span>
                    </div>
                    <ul className="text-[12.5px] text-steel mb-2.5">
                      {p.requests.map((r) => (
                        <li key={r.id} className="flex justify-between">
                          <span>
                            {r.catalogItem.name} × {r.quantity}
                            {r.creditDeduction > 0 && <span className="text-gold"> (con descuento de {money(r.creditDeduction)})</span>}
                          </span>
                          <span className="tabular-nums">{money(r.totalCost)}</span>
                        </li>
                      ))}
                      {p.excessReports.map((r) => (
                        <li key={`excess-${r.id}`} className="flex justify-between">
                          <span>
                            Excedente — {r.request.catalogItem.name} × {r.excessQty} un.
                            {r.request.requestNumber != null && ` — SC-${String(r.request.requestNumber).padStart(3, "0")}`}
                          </span>
                          <span className="tabular-nums">{money(r.amount)}</span>
                        </li>
                      ))}
                    </ul>

                    {p.transfers.length > 0 && (
                      <ul className="text-[12.5px] text-ink mb-2.5 border-t border-rule pt-2">
                        {p.transfers.map((t) => (
                          <li key={t.id} className="flex justify-between">
                            <span>{formatDateTime(t.transferDate)} · comp. {t.comprobanteNumber}</span>
                            <span className="tabular-nums">{money(t.amount)}</span>
                          </li>
                        ))}
                        <li className="flex justify-between text-steel mt-1">
                          <span>Transferido hasta ahora</span>
                          <span className="tabular-nums">{money(transfersTotal)} / {money(p.totalAmount)}</span>
                        </li>
                      </ul>
                    )}

                    {p.aiReviewSummary && (
                      <div className={`flex items-start gap-1.5 mb-2.5 rounded px-2.5 py-2 text-[12px] ${p.aiReviewOk ? "bg-teal/10 text-ink" : "bg-red/10 text-ink"}`}>
                        {p.aiReviewOk ? <CheckCircle2 size={13} className="text-teal shrink-0 mt-0.5" /> : <AlertTriangle size={13} className="text-red shrink-0 mt-0.5" />}
                        <span>{p.aiReviewSummary}</span>
                      </div>
                    )}

                    <div className="border-t border-rule pt-2.5 grid grid-cols-2 gap-2 text-[12px]">
                      <input placeholder="Monto" type="number" step="0.01" className="rounded border border-rule px-2 py-1" value={f.amount} onChange={(e) => setTransferField(p.id, "amount", e.target.value)} />
                      <input type="date" className="rounded border border-rule px-2 py-1" value={f.transferDate} onChange={(e) => setTransferField(p.id, "transferDate", e.target.value)} />
                      <input placeholder="Banco destino" className="rounded border border-rule px-2 py-1" value={f.bankNameDestino} onChange={(e) => setTransferField(p.id, "bankNameDestino", e.target.value)} />
                      <input placeholder="Cuenta destino" className="rounded border border-rule px-2 py-1" value={f.accountDestino} onChange={(e) => setTransferField(p.id, "accountDestino", e.target.value)} />
                      <input placeholder="Banco origen" className="rounded border border-rule px-2 py-1" value={f.bankNameOrigen} onChange={(e) => setTransferField(p.id, "bankNameOrigen", e.target.value)} />
                      <input placeholder="Cuenta origen" className="rounded border border-rule px-2 py-1" value={f.accountOrigen} onChange={(e) => setTransferField(p.id, "accountOrigen", e.target.value)} />
                      <input placeholder="N° de comprobante" className="rounded border border-rule px-2 py-1" value={f.comprobanteNumber} onChange={(e) => setTransferField(p.id, "comprobanteNumber", e.target.value)} />
                      <input placeholder="Costo de transacción" type="number" step="0.01" className="rounded border border-rule px-2 py-1" value={f.transactionCost} onChange={(e) => setTransferField(p.id, "transactionCost", e.target.value)} />
                      <input placeholder="IVA" type="number" step="0.01" className="rounded border border-rule px-2 py-1" value={f.iva} onChange={(e) => setTransferField(p.id, "iva", e.target.value)} />
                    </div>
                    <div className="mt-2">
                      {f.proofUrl ? (
                        <span className="text-[12px] text-teal">Captura subida ✓ <button type="button" className="text-steel underline decoration-dotted ml-1 cursor-pointer" onClick={() => setTransferField(p.id, "proofUrl", "")}>Cambiar</button></span>
                      ) : (
                        <button
                          type="button"
                          className="flex items-center gap-1.5 border-[1.5px] border-dashed border-rule rounded px-3 py-1.5 text-[12px] text-steel cursor-pointer hover:border-teal w-fit"
                          onClick={() => { pendingUploadPaymentId.current = p.id; fileInputRef.current?.click(); }}
                        >
                          {uploadingProof === p.id ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={13} />} Subir captura de la transferencia
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2.5">
                      <button type="button" className="rounded border border-rule bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink cursor-pointer disabled:opacity-60" disabled={busy} onClick={() => addTransfer(p.id)}>
                        Agregar transferencia
                      </button>
                      <button type="button" className="flex items-center gap-1.5 rounded border border-rule bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink cursor-pointer disabled:opacity-60" disabled={busy} onClick={() => runReview(p.id)}>
                        <Sparkles size={13} /> Revisar con IA
                      </button>
                      <button type="button" className="rounded border border-teal bg-teal px-3 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60" disabled={busy || p.transfers.length === 0} onClick={() => closePayment(p.id)}>
                        Cerrar tanda
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {summary.closedPayments.length > 0 && (
            <div>
              <h3 className="mb-2 text-[13px] font-semibold text-ink">Historial de tandas pagadas</h3>
              <div className="flex flex-col gap-1.5">
                {summary.closedPayments.map((p) => (
                  <div key={p.id} className="bg-surface border border-rule rounded-md px-3 py-2 text-[12.5px] flex justify-between">
                    <span>{p.code} — {formatDateTime(p.closedAt!)}</span>
                    <span className="font-semibold tabular-nums">{money(p.totalAmount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadProof(e.target.files[0])} />
    </div>
  );
}
