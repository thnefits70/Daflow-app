"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";

type Row = {
  id: string;
  groupId: string;
  status: "APPROVED" | "PAID" | "RECEIVED";
  quantity: number;
  totalCost: number;
  invoiceStatus: "PENDING" | "COMPLETE" | "PARTIAL" | "NON_FISCAL" | "NONE";
  invoiceAmount: number | null;
  paidAt: string | null;
  catalogItem: { name: string };
  supplier: { name: string };
};

const INVOICE_LABELS: Record<Row["invoiceStatus"], string> = {
  PENDING: "Pendiente de revisar",
  COMPLETE: "Factura completa (por el total pagado)",
  PARTIAL: "Factura parcial (por una parte)",
  NON_FISCAL: "Comprobante de compra (no es factura fiscal)",
  NONE: "No entrega ningún documento",
};

function money(n: number) {
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;
}

function groupRows(rows: Row[]) {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    if (!map.has(r.groupId)) map.set(r.groupId, []);
    map.get(r.groupId)!.push(r);
  }
  return [...map.values()];
}

export function PurchaseInvoicingPanel() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pettyCash, setPettyCash] = useState<{ count: number; total: number } | null>(null);
  const [payingGroup, setPayingGroup] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const onPasteProof = usePasteFile((file) => uploadProof(file));
  const [partialAmounts, setPartialAmounts] = useState<Record<string, string>>({});
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/purchase-requests?view=invoicing").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
    fetch("/api/purchase-requests/petty-cash-summary").then((r) => (r.ok ? r.json() : null)).then(setPettyCash).catch(() => null);
  }
  useEffect(load, []);

  async function pay(groupId: string) {
    if (!proofUrl) {
      setErr("Sube el comprobante de pago.");
      return;
    }
    setBusyGroup(groupId);
    setErr("");
    const res = await fetch(`/api/purchase-requests/group/${groupId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentProofUrl: proofUrl }),
    });
    setBusyGroup(null);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo registrar el pago.");
      return;
    }
    setPayingGroup(null);
    setProofUrl(null);
    load();
    router.refresh();
  }

  async function setInvoice(groupId: string, invoiceStatus: Row["invoiceStatus"]) {
    if (invoiceStatus === "PARTIAL" && !partialAmounts[groupId]) return;
    setBusyGroup(groupId);
    await fetch(`/api/purchase-requests/group/${groupId}/invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceStatus, invoiceAmount: invoiceStatus === "PARTIAL" ? Number(partialAmounts[groupId]) : undefined }),
    });
    setBusyGroup(null);
    load();
  }

  async function uploadProof(file: File) {
    setUploadingProof(true);
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-payments");
    setUploadingProof(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setProofUrl(uploaded.url);
  }

  if (!rows) return <div className="text-steel text-[13px]">Cargando…</div>;

  const approvedGroups = groupRows(rows.filter((r) => r.status === "APPROVED"));
  const restGroups = groupRows(rows.filter((r) => r.status !== "APPROVED"));

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
                  <div className="text-[11.5px] text-steel mb-2.5">{g[0].supplier.name} — {money(total)}</div>
                  {payingGroup === groupId ? (
                    <div>
                      {proofUrl ? (
                        <img src={proofUrl} alt="" className="w-16 h-16 rounded object-cover border border-rule mb-2" />
                      ) : (
                        <label
                          tabIndex={0}
                          onPaste={onPasteProof}
                          className="flex items-center gap-1.5 border-[1.5px] border-dashed border-rule rounded px-3 py-2 text-[12px] text-steel cursor-pointer hover:border-teal focus:border-teal focus:outline-none w-fit mb-2"
                        >
                          {uploadingProof ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={13} />} Subir o pegar comprobante
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadProof(e.target.files[0])} />
                        </label>
                      )}
                      {err && <div className="text-red text-[12px] mb-2">{err}</div>}
                      <div className="flex items-center gap-2">
                        <button type="button" disabled={busyGroup === groupId} className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => pay(groupId)}>
                          Confirmar pago
                        </button>
                        <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={() => setPayingGroup(null)}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer" onClick={() => { setPayingGroup(groupId); setProofUrl(null); setErr(""); }}>
                      💳 Marcar como pagado
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Registrar factura</div>
      {restGroups.length === 0 && <div className="border-[1.5px] border-dashed border-rule rounded-md p-6 text-center text-steel text-[13px]">Nada por aquí todavía.</div>}
      <div className="flex flex-col gap-2.5">
        {restGroups.map((g) => {
          const groupId = g[0].groupId;
          const total = g.reduce((s, r) => s + r.totalCost, 0);
          const r0 = g[0];
          return (
            <div key={groupId} className="bg-surface border border-rule rounded-md p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                <div>
                  {g.map((r) => (
                    <div key={r.id} className="text-[13.5px] font-bold">{r.catalogItem.name} · {r.quantity} un.</div>
                  ))}
                  <div className="text-[11.5px] text-steel">{r0.supplier.name} — Pagado {money(total)} {r0.paidAt ? `· ${new Date(r0.paidAt).toLocaleDateString("es-MX")}` : ""}</div>
                </div>
                <select
                  className="rounded border border-rule bg-surface2 px-2.5 py-1.5 text-[12px]"
                  value={r0.invoiceStatus}
                  onChange={(e) => setInvoice(groupId, e.target.value as Row["invoiceStatus"])}
                >
                  {Object.entries(INVOICE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </div>
              {r0.invoiceStatus === "PARTIAL" && (
                <div className="flex items-center gap-2">
                  <input
                    type="number" step="0.01" placeholder="¿Por qué valor se facturó?"
                    className="rounded border border-rule px-2.5 py-1.5 text-[12.5px] w-48"
                    value={partialAmounts[groupId] ?? (r0.invoiceAmount ?? "")}
                    onChange={(e) => setPartialAmounts((p) => ({ ...p, [groupId]: e.target.value }))}
                  />
                  <button type="button" disabled={busyGroup === groupId} className="rounded border border-blue bg-blue px-3 py-1.5 text-[11.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => setInvoice(groupId, "PARTIAL")}>
                    Guardar valor
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
