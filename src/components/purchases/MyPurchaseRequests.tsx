"use client";

import { useEffect, useState } from "react";
import { FileText, Upload, Truck, CheckCircle2, Plus, Bell } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";
import { PurchaseSupplierPicker, type BankAccountDTO, type PurchaseSupplierDTO } from "./PurchaseSupplierPicker";
import { PurchaseOperationDocuments } from "./PurchaseOperationDocuments";
import { actorName } from "@/lib/actorName";

// Nota: formateo puro repetido a propósito (no importado de purchases.ts)
// porque ese archivo trae `prisma` y este componente es "use client" — igual
// que recognitionAdmin.ts/recognition.ts, mezclar rompe el build de Turbopack.
function formatPurchaseRequestCode(requestNumber: number): string {
  return `SC-${String(requestNumber).padStart(3, "0")}`;
}

type Row = {
  id: string;
  groupId: string;
  requestNumber: number | null;
  status: "PENDING_APPROVAL" | "REJECTED" | "APPROVED" | "PAID" | "RECEIVED";
  quantity: number;
  unitCost: number;
  totalCost: number;
  requestedAt: string;
  rejectReason: string | null;
  attemptNumber: number;
  catalogItem: { id: string; name: string; photos: string[] };
  quoteImageUrl: string;
  quoteReadTotal: number | null;
  quoteReferenceCode: string | null;
  justification: string | null;
  invoiceStatus: string;
  invoiceDocUrl: string | null;
  purchaseOrderUrl: string | null;
  paymentProofUrl: string | null;
  shippingPaymentProofUrl: string | null;
  shippingIncluded: boolean;
  shippingCarrierPending: boolean;
  shippingPaymentTiming: "WITH_PURCHASE" | "ON_DELIVERY" | null;
  shippingPaymentMethod: "TRANSFER" | "PETTY_CASH" | null;
  shippingCostTotal: number | null;
  carrier: { id: string; name: string; bankAccounts: BankAccountDTO[] } | null;
  carrierBankAccountId: string | null;
  shippingPaymentRequestedAt: string | null;
  shippingPaidAt: string | null;
  requestedBy: { name: string } | null;
  reviewedBy: { name: string } | null;
  paidBy: { name: string } | null;
  invoicedBy: { name: string } | null;
  receipt: {
    photoUrls: string[];
    receivedQuantity: number;
    aiPhotoMatch: boolean | null;
    aiPhotoNote: string | null;
    confirmedBy: { name: string } | null;
  } | null;
  supplier: { id: string; name: string; bankAccounts: BankAccountDTO[] };
  bankAccountId: string | null;
  bankAccountChangeRequestedAt: string | null;
  bankAccountChangeNote: string | null;
};

const STEPS: { key: Row["status"]; label: string }[] = [
  { key: "PENDING_APPROVAL", label: "Enviado" },
  { key: "APPROVED", label: "Aprobado" },
  { key: "PAID", label: "Pagado" },
  { key: "RECEIVED", label: "Recibido" },
];

function stepIndex(status: Row["status"]) {
  if (status === "REJECTED") return -1;
  return STEPS.findIndex((s) => s.key === status);
}

function groupRows(rows: Row[]) {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    if (!map.has(r.groupId)) map.set(r.groupId, []);
    map.get(r.groupId)!.push(r);
  }
  return [...map.values()];
}

const emptyAccountForm = { bankName: "", bankAccountType: "", bankAccountNumber: "", bankAccountHolder: "", holderIdType: "" as "" | "RUC" | "CEDULA", holderIdNumber: "" };

function attemptLabel(n: number) {
  if (n === 2) return "2do intento";
  if (n === 3) return "3er intento";
  return `${n}to intento`;
}

// Confirmado 2026-08-06: cuando el admin no pudo pagar con la cuenta elegida
// (datos mal, el banco rechaza la transferencia), pide con un clic que se
// cambie — acá se elige otra cuenta ya registrada del proveedor o se agrega
// una nueva, mismo patrón que la cuenta del transportista.
function BankAccountChangeSection({ g, onUpdate }: { g: Row[]; onUpdate: (patch: Partial<Row>) => void }) {
  const r0 = g[0];
  const groupId = r0.groupId;
  const supplier = r0.supplier;
  const [addingAccount, setAddingAccount] = useState(false);
  const [accountForm, setAccountForm] = useState(emptyAccountForm);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function chooseAccount(bankAccountId: string) {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/group/${groupId}/bank-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankAccountId }),
    });
    setBusy(false);
    if (!res.ok) { setErr("No se pudo cambiar la cuenta."); return; }
    onUpdate({ bankAccountId, bankAccountChangeRequestedAt: null, bankAccountChangeNote: null });
  }

  async function addAccount() {
    if (!accountForm.bankName.trim() || !accountForm.bankAccountType.trim() || !accountForm.bankAccountNumber.trim() || !accountForm.bankAccountHolder.trim() || !accountForm.holderIdType || !accountForm.holderIdNumber.trim()) {
      setErr("Completa todos los campos.");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-suppliers/${supplier.id}/bank-accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(accountForm),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setBusy(false);
      setErr(data?.error ?? "No se pudo guardar la cuenta.");
      return;
    }
    await chooseAccount(data.id);
    setAddingAccount(false);
    setAccountForm(emptyAccountForm);
  }

  return (
    <div className="mt-3 pt-3 border-t border-rule">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold mb-2" style={{ color: "#D9A441" }}>
        🏦 El admin no pudo pagar con la cuenta actual{r0.bankAccountChangeNote ? ` — "${r0.bankAccountChangeNote}"` : ""}
      </div>
      <div className="text-[11.5px] text-steel mb-2">Elige otra cuenta de {supplier.name} o agrega una nueva.</div>

      {supplier.bankAccounts.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-2.5">
          {supplier.bankAccounts.map((acc) => (
            <div
              key={acc.id}
              onClick={() => !busy && chooseAccount(acc.id)}
              className={`flex items-center gap-2 rounded border px-2.5 py-2 cursor-pointer ${acc.id === r0.bankAccountId ? "border-teal bg-teal/10" : "border-rule bg-surface2 hover:border-teal"}`}
            >
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2.5 gap-y-0.5 flex-1 min-w-0 text-[11.5px]">
                <div><span className="text-steel">Banco: </span><span className="font-semibold break-words">{acc.bankName}</span></div>
                <div><span className="text-steel">Tipo: </span><span className="font-semibold break-words">{acc.bankAccountType}</span></div>
                <div><span className="text-steel">N°: </span><span className="font-semibold break-all">{acc.bankAccountNumber}</span></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {addingAccount ? (
        <div className="bg-surface2 border border-rule rounded-md p-2.5 mb-2">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input className="rounded border border-rule px-2 py-1.5 text-[12px]" placeholder="Banco" value={accountForm.bankName} onChange={(e) => setAccountForm((f) => ({ ...f, bankName: e.target.value }))} />
            <input className="rounded border border-rule px-2 py-1.5 text-[12px]" placeholder="N° de cuenta" value={accountForm.bankAccountNumber} onChange={(e) => setAccountForm((f) => ({ ...f, bankAccountNumber: e.target.value }))} />
          </div>
          <div className="flex gap-1.5 mb-2">
            {["Ahorro", "Corriente"].map((t) => (
              <button key={t} type="button" className={`flex-1 rounded border py-1 text-[11.5px] font-semibold cursor-pointer ${accountForm.bankAccountType === t ? "border-teal bg-teal/10 text-teal" : "border-rule text-steel"}`} onClick={() => setAccountForm((f) => ({ ...f, bankAccountType: t }))}>
                {t}
              </button>
            ))}
          </div>
          <input className="w-full rounded border border-rule px-2 py-1.5 text-[12px] mb-2" placeholder="Titular de la cuenta" value={accountForm.bankAccountHolder} onChange={(e) => setAccountForm((f) => ({ ...f, bankAccountHolder: e.target.value }))} />
          <div className="flex gap-1.5 mb-2">
            {[{ v: "RUC", l: "RUC" }, { v: "CEDULA", l: "Cédula" }].map((o) => (
              <button key={o.v} type="button" className={`flex-1 rounded border py-1 text-[11.5px] font-semibold cursor-pointer ${accountForm.holderIdType === o.v ? "border-teal bg-teal/10 text-teal" : "border-rule text-steel"}`} onClick={() => setAccountForm((f) => ({ ...f, holderIdType: o.v as "RUC" | "CEDULA" }))}>
                {o.l}
              </button>
            ))}
          </div>
          <input className="w-full rounded border border-rule px-2 py-1.5 text-[12px] mb-2" placeholder={accountForm.holderIdType === "CEDULA" ? "N° de cédula" : "N° de RUC"} value={accountForm.holderIdNumber} onChange={(e) => setAccountForm((f) => ({ ...f, holderIdNumber: e.target.value }))} />
          {err && <div className="text-red text-[11.5px] mb-2">{err}</div>}
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy} className="rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={addAccount}>
              Guardar y usar esta cuenta
            </button>
            <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => { setAddingAccount(false); setErr(""); }}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="flex items-center gap-1 text-[11.5px] text-blue font-semibold cursor-pointer" onClick={() => setAddingAccount(true)}>
          <Plus size={12} /> Agregar cuenta bancaria nueva
        </button>
      )}
      {err && !addingAccount && <div className="text-red text-[11.5px] mt-1.5">{err}</div>}
    </div>
  );
}

// Confirmado 2026-08-03: cuando el flete se dejó "pendiente hasta que llegue
// la mercadería", una vez Inventario confirma la recepción (ya llega su
// propia notificación push de "mercadería recibida"), acá aparece la opción
// de pedir con un clic que se pague — y si el transportista todavía no dio
// su cuenta bancaria (algunos solo la dan al entregar), se puede agregar
// justo en este momento.
function ShippingPaymentSection({ g, onUpdate }: { g: Row[]; onUpdate: (patch: Partial<Row>) => void }) {
  const r0 = g[0];
  const [addingAccount, setAddingAccount] = useState(false);
  const [accountForm, setAccountForm] = useState(emptyAccountForm);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const carrier = r0.carrier;
  const hasAccount = !!r0.carrierBankAccountId;
  const requested = !!r0.shippingPaymentRequestedAt;

  async function addAccount() {
    if (!carrier) return;
    if (!accountForm.bankName.trim() || !accountForm.bankAccountType.trim() || !accountForm.bankAccountNumber.trim() || !accountForm.bankAccountHolder.trim() || !accountForm.holderIdType || !accountForm.holderIdNumber.trim()) {
      setErr("Completa todos los campos.");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-suppliers/${carrier.id}/bank-accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(accountForm),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setBusy(false);
      setErr(data?.error ?? "No se pudo guardar la cuenta.");
      return;
    }
    const setRes = await fetch(`/api/purchase-requests/group/${r0.groupId}/carrier-bank-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carrierBankAccountId: data.id }),
    });
    setBusy(false);
    if (!setRes.ok) {
      setErr("No se pudo asignar la cuenta.");
      return;
    }
    onUpdate({ carrierBankAccountId: data.id });
    setAddingAccount(false);
    setAccountForm(emptyAccountForm);
  }

  async function requestPayment() {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/group/${r0.groupId}/request-shipping-payment`, { method: "POST" });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo enviar la solicitud.");
      return;
    }
    onUpdate({ shippingPaymentRequestedAt: new Date().toISOString() });
  }

  if (r0.shippingPaidAt) {
    return (
      <div className="mt-3 pt-3 border-t border-rule flex items-center gap-1.5 text-[12px] text-teal">
        <CheckCircle2 size={13} /> Flete pagado
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-rule">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold mb-2" style={{ color: "#D9A441" }}>
        <Truck size={13} /> Flete pendiente — ${(r0.shippingCostTotal ?? 0).toFixed(2)} a {carrier?.name ?? "transportista"}
      </div>

      {!hasAccount && (
        addingAccount ? (
          <div className="bg-surface2 border border-rule rounded-md p-2.5 mb-2">
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input className="rounded border border-rule px-2 py-1.5 text-[12px]" placeholder="Banco" value={accountForm.bankName} onChange={(e) => setAccountForm((f) => ({ ...f, bankName: e.target.value }))} />
              <input className="rounded border border-rule px-2 py-1.5 text-[12px]" placeholder="N° de cuenta" value={accountForm.bankAccountNumber} onChange={(e) => setAccountForm((f) => ({ ...f, bankAccountNumber: e.target.value }))} />
            </div>
            <div className="flex gap-1.5 mb-2">
              {["Ahorro", "Corriente"].map((t) => (
                <button key={t} type="button" className={`flex-1 rounded border py-1 text-[11.5px] font-semibold cursor-pointer ${accountForm.bankAccountType === t ? "border-teal bg-teal/10 text-teal" : "border-rule text-steel"}`} onClick={() => setAccountForm((f) => ({ ...f, bankAccountType: t }))}>
                  {t}
                </button>
              ))}
            </div>
            <input className="w-full rounded border border-rule px-2 py-1.5 text-[12px] mb-2" placeholder="Titular de la cuenta" value={accountForm.bankAccountHolder} onChange={(e) => setAccountForm((f) => ({ ...f, bankAccountHolder: e.target.value }))} />
            <div className="flex gap-1.5 mb-2">
              {[{ v: "RUC", l: "RUC" }, { v: "CEDULA", l: "Cédula" }].map((o) => (
                <button key={o.v} type="button" className={`flex-1 rounded border py-1 text-[11.5px] font-semibold cursor-pointer ${accountForm.holderIdType === o.v ? "border-teal bg-teal/10 text-teal" : "border-rule text-steel"}`} onClick={() => setAccountForm((f) => ({ ...f, holderIdType: o.v as "RUC" | "CEDULA" }))}>
                  {o.l}
                </button>
              ))}
            </div>
            <input className="w-full rounded border border-rule px-2 py-1.5 text-[12px] mb-2" placeholder={accountForm.holderIdType === "CEDULA" ? "N° de cédula" : "N° de RUC"} value={accountForm.holderIdNumber} onChange={(e) => setAccountForm((f) => ({ ...f, holderIdNumber: e.target.value }))} />
            {err && <div className="text-red text-[11.5px] mb-2">{err}</div>}
            <div className="flex items-center gap-2">
              <button type="button" disabled={busy} className="rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={addAccount}>
                Guardar cuenta
              </button>
              <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => { setAddingAccount(false); setErr(""); }}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="flex items-center gap-1 text-[11.5px] text-blue font-semibold cursor-pointer mb-2" onClick={() => setAddingAccount(true)}>
            <Plus size={12} /> Agregar cuenta bancaria del transportista
          </button>
        )
      )}

      {err && !addingAccount && <div className="text-red text-[11.5px] mb-2">{err}</div>}

      {r0.shippingPaymentMethod === "PETTY_CASH" ? (
        <div className="text-[11.5px] text-steel">Se paga con caja chica — Bryan Ríos lo registra desde su Caja Chica cuando llegue la mercadería.</div>
      ) : requested ? (
        <div className="text-[11.5px] text-steel">✓ Ya se le pidió al administrador que pague el flete — esperando confirmación.</div>
      ) : !hasAccount ? (
        <div className="text-[11.5px] text-steel">Agrega la cuenta bancaria del transportista (arriba) antes de poder pedir el pago.</div>
      ) : (
        <button type="button" disabled={busy} className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={requestPayment}>
          Pedir que se pague el flete
        </button>
      )}
    </div>
  );
}

// Confirmado 2026-08-11: pedido explícito del usuario — cuando se solicitó
// marcando "todavía no sé el transportista ni el costo del flete", esto
// aparece hasta que se complete con los datos reales (mismo patrón que la
// orden de compra pendiente, arriba).
function ShippingCarrierPendingSection({ g, onUpdate, isAdmin }: { g: Row[]; onUpdate: (patch: Partial<Row>) => void; isAdmin: boolean }) {
  const r0 = g[0];
  const [carrier, setCarrier] = useState<PurchaseSupplierDTO | null>(null);
  const [carrierBankAccountId, setCarrierBankAccountId] = useState<string | null>(null);
  const [cost, setCost] = useState("");
  const [method, setMethod] = useState<"TRANSFER" | "PETTY_CASH">("TRANSFER");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!carrier) { setErr("Elige el transportista."); return; }
    const n = Number(cost);
    if (!cost || Number.isNaN(n) || n < 0) { setErr("Ingresa el costo del flete."); return; }
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/group/${r0.groupId}/carrier-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carrierId: carrier.id, shippingCostTotal: n, shippingPaymentMethod: method, carrierBankAccountId }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo guardar."); return; }
    onUpdate({
      shippingCarrierPending: false,
      carrier: { id: carrier.id, name: carrier.name, bankAccounts: carrier.bankAccounts },
      carrierBankAccountId,
      shippingCostTotal: n,
      shippingPaymentTiming: "ON_DELIVERY",
    });
  }

  return (
    <div className="mt-3 pt-3 border-t border-dashed border-gold/40">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold mb-2" style={{ color: "#D9A441" }}>
        <Truck size={13} /> Falta completar el transportista y el costo del flete
      </div>
      <PurchaseSupplierPicker
        type="CARRIER"
        value={carrier}
        onChange={(c) => { setCarrier(c); if (!c) setCarrierBankAccountId(null); }}
        label="Buscar o registrar transportista"
        isAdmin={isAdmin}
        selectedBankAccountId={carrierBankAccountId}
        onSelectBankAccount={setCarrierBankAccountId}
      />
      <div className="grid grid-cols-2 gap-2.5 mt-2.5">
        <div>
          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Costo de envío (total)</label>
          <input type="number" min="0" step="0.01" className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={cost} onChange={(e) => setCost(e.target.value)} />
        </div>
        <div>
          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">¿Cómo se paga?</label>
          <select className="w-full rounded border border-rule bg-surface px-2.5 py-2 text-[13px]" value={method} onChange={(e) => setMethod(e.target.value as "TRANSFER" | "PETTY_CASH")}>
            <option value="TRANSFER">Transferencia bancaria</option>
            <option value="PETTY_CASH">Efectivo — caja chica</option>
          </select>
        </div>
      </div>
      {err && <div className="text-red text-[11.5px] mt-2">{err}</div>}
      <button type="button" disabled={busy} className="mt-2.5 rounded border border-blue bg-blue px-3.5 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={submit}>
        Guardar
      </button>
    </div>
  );
}

// Confirmado 2026-08-07: reenviar una solicitud rechazada arma un borrador
// con TODO lo que ya se había llenado (mismo mecanismo de borrador que ya
// usa PurchaseRequestForm para "retomar sin terminar") y lo deja listo en
// la pestaña Solicitar — la persona revisa el motivo del rechazo y corrige
// solo lo que haga falta, sin volver a escribir todo desde cero.
function buildResubmitDraft(g: Row[]) {
  const r0 = g[0];
  return {
    lines: g.map((r) => ({
      catalogItem: { id: r.catalogItem.id, name: r.catalogItem.name, photos: [] },
      productQuery: r.catalogItem.name,
      quantity: String(r.quantity),
      unitCost: String(r.unitCost),
      ivaIncluded: false,
    })),
    supplier: { id: r0.supplier.id, name: r0.supplier.name, location: null, email: null, bankAccounts: r0.supplier.bankAccounts, contacts: [] },
    bankAccountId: r0.bankAccountId,
    quoteImageUrl: r0.quoteImageUrl,
    verifyResult: {
      readTotal: r0.quoteReadTotal,
      productNameFound: r0.quoteReferenceCode ? null : r0.catalogItem.name,
      referenceCodeFound: r0.quoteReferenceCode,
      matches: !r0.quoteReferenceCode,
      suggestedCatalogItem: null,
    },
    manualCodeConfirm: !!r0.quoteReferenceCode,
    purchaseOrderUrl: r0.purchaseOrderUrl,
    shippingIncluded: r0.shippingIncluded,
    shippingCarrierPending: r0.shippingCarrierPending,
    carrier: r0.carrier ? { id: r0.carrier.id, name: r0.carrier.name, location: null, email: null, bankAccounts: r0.carrier.bankAccounts, contacts: [] } : null,
    carrierBankAccountId: r0.carrierBankAccountId,
    shippingCostTotal: r0.shippingCostTotal != null ? String(r0.shippingCostTotal) : "",
    shippingPaymentMethod: "TRANSFER",
    shippingPaymentTiming: r0.shippingPaymentTiming ?? "WITH_PURCHASE",
    justification: r0.justification ?? "",
    editingGroupId: r0.groupId,
    nextAttemptNumber: r0.attemptNumber + 1,
  };
}

function GroupCard({
  g,
  onPurchaseOrderUploaded,
  onGroupUpdate,
  onResubmit,
  isAdmin,
}: {
  g: Row[];
  onPurchaseOrderUploaded: (groupId: string, url: string) => void;
  onGroupUpdate: (groupId: string, patch: Partial<Row>) => void;
  onResubmit: (draft: ReturnType<typeof buildResubmitDraft>) => void;
  isAdmin: boolean;
}) {
  const groupId = g[0].groupId;
  const total = g.reduce((s, r) => s + r.totalCost, 0);
  const rejected = g[0].status === "REJECTED";
  const needsPurchaseOrder = !rejected && !g[0].purchaseOrderUrl;
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [reminded, setReminded] = useState(false);
  const { onPaste, onMouseEnter: onPasteHoverIn, onMouseLeave: onPasteHoverOut } = usePasteFile((file) => handleFile(file));

  // Confirmado 2026-08-13: pedido explícito del usuario — Bryan también
  // tiene que ver reflejado, en su propio "Mis solicitudes", el crédito que
  // ya quedó reservado para esta solicitud desde que la pidió — mismo
  // ajuste que ya se hizo en la Bandeja de aprobación.
  const [reservedCredits, setReservedCredits] = useState<{ id: string; amount: number; reason: string }[]>([]);
  useEffect(() => {
    if (rejected) return;
    fetch(`/api/purchase-suppliers/${g[0].supplier.id}/credit-balance?groupId=${groupId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setReservedCredits(data?.reserved ?? []))
      .catch(() => setReservedCredits([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);
  const reservedTotal = reservedCredits.reduce((s, c) => s + c.amount, 0);
  const netTotal = Math.max(0, total - reservedTotal);

  // Si un grupo tiene varios productos, cada uno puede llegar por separado
  // (Inventario confirma producto por producto) — el avance general muestra
  // el paso MÁS ATRASADO de todos.
  const groupIdx = Math.min(...g.map((r) => stepIndex(r.status)));
  const statusesDiffer = new Set(g.map((r) => r.status)).size > 1;
  // Confirmado 2026-08-14: antes exigía status RECEIVED (Inventario ya
  // revisó), pero eso bloqueaba pedir el pago del flete mientras la
  // mercadería ya está físicamente en bodega esperando revisión — el
  // transportista no puede esperar a que Daniel tenga tiempo de confirmar.
  // Ahora solo exige que la solicitud ya esté aprobada (no pendiente, no
  // rechazada); Inventario se entera aparte de que hay algo pagado por
  // revisar (ver shipping-pay/route.ts).
  const showShippingSection = !rejected && !g[0].shippingIncluded && g[0].shippingPaymentTiming === "ON_DELIVERY" && g[0].status !== "PENDING_APPROVAL";

  async function handleFile(file: File) {
    setUploading(true);
    setErr("");
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-orders");
    if (!uploaded.ok) {
      setUploading(false);
      setErr(uploaded.error);
      return;
    }
    const res = await fetch(`/api/purchase-requests/group/${groupId}/purchase-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchaseOrderUrl: uploaded.url }),
    });
    setUploading(false);
    if (!res.ok) {
      setErr("No se pudo guardar la orden de compra.");
      return;
    }
    onPurchaseOrderUploaded(groupId, uploaded.url);
  }

  async function remindPayment() {
    const target = g.find((r) => r.status === "APPROVED") ?? g[0];
    await fetch(`/api/purchase-requests/${target.id}/remind-payment`, { method: "POST" }).catch(() => null);
    setReminded(true);
    setTimeout(() => setReminded(false), 2500);
  }

  return (
    <div className={`bg-surface border rounded-md p-4 ${needsPurchaseOrder ? "border-gold/40" : "border-rule"}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2.5">
        <div>
          {g[0].requestNumber !== null && (
            <div className="font-mono text-[10.5px] text-teal mb-0.5 flex items-center gap-1.5">
              {formatPurchaseRequestCode(g[0].requestNumber)}
              {g[0].attemptNumber > 1 && <span className="text-steel-dim font-sans">— {attemptLabel(g[0].attemptNumber)}</span>}
            </div>
          )}
          {g.map((r) => (
            <div key={r.id} className="text-[13.5px] font-bold">
              {r.catalogItem.name} · {r.quantity} un.
              {statusesDiffer && !rejected && (
                <span className="ml-2 text-[10.5px] font-semibold text-steel">— {STEPS[stepIndex(r.status)]?.label ?? r.status}</span>
              )}
            </div>
          ))}
          {reservedTotal > 0 ? (
            <div className="text-[11.5px] text-steel">
              <span className="line-through text-steel-dim">${total.toFixed(2)}</span>{" "}
              <span className="text-teal font-semibold">${netTotal.toFixed(2)} neto</span>{" "}
              <span className="text-steel-dim">(crédito de ${reservedTotal.toFixed(2)} aplicado)</span> · {new Date(g[0].requestedAt).toLocaleDateString("es-MX")}
            </div>
          ) : (
            <div className="text-[11.5px] text-steel">${total.toFixed(2)} · {new Date(g[0].requestedAt).toLocaleDateString("es-MX")}</div>
          )}
        </div>
      </div>
      {rejected ? (
        <div>
          <div className="text-[12px] text-red mb-2">Rechazada{g[0].rejectReason ? ` — ${g[0].rejectReason}` : ""}</div>
          <button
            type="button"
            className="rounded border border-blue bg-blue px-3 py-1.5 text-[12px] font-semibold text-white cursor-pointer"
            onClick={() => onResubmit(buildResubmitDraft(g))}
          >
            Corregir y reenviar
          </button>
        </div>
      ) : (
        <>
          <div className="flex gap-1.5">
            {STEPS.map((s, i) => (
              <div key={s.key} className={`flex-1 rounded-md py-1.5 text-center text-[10.5px] font-semibold border ${i <= groupIdx ? "border-green/45 text-green bg-green/10" : "border-rule text-steel bg-cloud"}`}>
                {s.label}
              </div>
            ))}
          </div>
          <div className="text-[10px] text-steel-dim mt-1.5">
            {groupIdx >= 1 && <>Aprobada por {actorName(g[0].reviewedBy?.name)} · </>}
            {groupIdx >= 2 && <>Pagada por {actorName(g[0].paidBy?.name)} · </>}
            {groupIdx >= 3 && <>Recibida por {[...new Set(g.map((r) => actorName(r.receipt?.confirmedBy?.name)))].join(", ")}</>}
          </div>
          {groupIdx === 1 && (
            <button
              type="button"
              className="flex items-center gap-1.5 mt-2 text-[11.5px] font-semibold text-steel border border-rule rounded px-2.5 py-1.5 cursor-pointer"
              onClick={remindPayment}
            >
              <Bell size={12} /> {reminded ? "✓ Enviado" : "Recordar pago al admin"}
            </button>
          )}
        </>
      )}

      {needsPurchaseOrder && (
        <div className="mt-3 pt-3 border-t border-rule">
          <label
            tabIndex={0}
            onPaste={onPaste}
            onMouseEnter={onPasteHoverIn}
            onMouseLeave={onPasteHoverOut}
            className="flex items-center justify-center gap-2 border-[1.5px] border-dashed border-gold/50 rounded-md py-2.5 cursor-pointer text-[12px] focus:outline-none focus:border-gold"
            style={{ color: "#D9A441" }}
          >
            {uploading ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={14} />}
            Falta subir la orden de compra — subir o pegar (pasa el mouse y Ctrl+V)
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </label>
          <label className="flex items-center justify-center gap-1.5 mt-1.5 text-[10.5px] text-steel cursor-pointer hover:text-teal">
            <FileText size={10.5} /> ¿Es un PDF? Subir documento
            <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </label>
          {err && <div className="text-red text-[11.5px] mt-1.5">{err}</div>}
        </div>
      )}

      {!rejected && g[0].shippingCarrierPending && (
        <ShippingCarrierPendingSection g={g} onUpdate={(patch) => onGroupUpdate(groupId, patch)} isAdmin={isAdmin} />
      )}

      {!rejected && g[0].bankAccountChangeRequestedAt && (
        <BankAccountChangeSection g={g} onUpdate={(patch) => onGroupUpdate(groupId, patch)} />
      )}

      {showShippingSection && <ShippingPaymentSection g={g} onUpdate={(patch) => onGroupUpdate(groupId, patch)} />}

      {/* Confirmado 2026-08-13: pedido explícito del usuario — apenas queda
          Pagada, quien la pidió (hoy Bryan, a cargo provisional de Compras)
          puede ver y descargar los comprobantes ya subidos, para poder
          enviárselos al proveedor — solo lectura, nunca editar ni borrar. */}
      {!rejected && groupIdx >= 2 && <PurchaseOperationDocuments rows={g} />}
    </div>
  );
}

export function MyPurchaseRequests({ onResubmit, isAdmin = false }: { onResubmit: (draft: ReturnType<typeof buildResubmitDraft>) => void; isAdmin?: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    fetch("/api/purchase-requests?view=mine").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }, []);

  if (!rows) return <div className="text-steel text-[13px]">Cargando…</div>;
  if (rows.length === 0) return <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13.5px]">Todavía no has enviado ninguna solicitud.</div>;

  const groups = groupRows(rows);
  const pendingPOCount = groups.filter((g) => g[0].status !== "REJECTED" && !g[0].purchaseOrderUrl).length;

  function markUploaded(groupId: string, url: string) {
    setRows((rs) => rs && rs.map((r) => (r.groupId === groupId ? { ...r, purchaseOrderUrl: url } : r)));
  }
  function updateGroup(groupId: string, patch: Partial<Row>) {
    setRows((rs) => rs && rs.map((r) => (r.groupId === groupId ? { ...r, ...patch } : r)));
  }

  return (
    <div>
      {pendingPOCount > 0 && (
        <div className="flex items-center gap-2 bg-gold/10 border border-gold/35 rounded-md px-3.5 py-2.5 mb-3.5 text-[12.5px]" style={{ color: "#D9A441" }}>
          <FileText size={15} />
          Te {pendingPOCount === 1 ? "falta subir la orden de compra de 1 solicitud" : `faltan subir las órdenes de compra de ${pendingPOCount} solicitudes`} — señaladas abajo.
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        {groups.map((g) => (
          <GroupCard key={g[0].groupId} g={g} onPurchaseOrderUploaded={markUploaded} onGroupUpdate={updateGroup} onResubmit={onResubmit} isAdmin={isAdmin} />
        ))}
      </div>
    </div>
  );
}
