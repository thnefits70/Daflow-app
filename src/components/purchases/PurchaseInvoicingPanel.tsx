"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, CheckCircle2 } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";

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
  paidAt: string | null;
  catalogItem: { name: string };
  supplier: { name: string };
};

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

  async function uploadInvoiceDoc(groupId: string, file: File) {
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
                          onMouseEnter={onPasteProofHoverIn}
                          onMouseLeave={onPasteProofHoverOut}
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
          const isYes = (choice[groupId] ?? "YES") === "YES";
          return (
            <div key={groupId} className="bg-surface border border-rule rounded-md p-4">
              <div className="mb-2.5">
                {g.map((r) => (
                  <div key={r.id} className="text-[13.5px] font-bold">{r.catalogItem.name} · {r.quantity} un.</div>
                ))}
                <div className="text-[11.5px] text-steel">{r0.supplier.name} — Pagado {money(total)} {r0.paidAt ? `· ${new Date(r0.paidAt).toLocaleDateString("es-MX")}` : ""}</div>
              </div>

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
                        <div className="flex items-center gap-1.5 text-[11.5px] text-teal mb-2.5"><CheckCircle2 size={13} /> Documento subido</div>
                      ) : (
                        <label
                          tabIndex={0}
                          onPaste={onPasteInvoiceDoc}
                          onMouseEnter={() => { invoiceDocGroupRef.current = groupId; armInvoiceDocPaste(); }}
                          onMouseLeave={() => { invoiceDocGroupRef.current = null; disarmInvoiceDocPaste(); }}
                          className="flex items-center gap-1.5 border-[1.5px] border-dashed border-rule rounded px-3 py-2 text-[11.5px] text-steel cursor-pointer hover:border-teal focus:border-teal focus:outline-none w-fit mb-2.5"
                        >
                          {uploadingDoc === groupId ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={12} />} Subir o pegar la factura (opcional)
                          <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && uploadInvoiceDoc(groupId, e.target.files[0])} />
                        </label>
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
                <div className="flex items-center justify-between gap-2 bg-cloud border border-rule rounded-md px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[12px] text-teal">
                    <CheckCircle2 size={13} /> {INVOICE_LABELS[r0.invoiceStatus]}{r0.invoiceStatus === "PARTIAL" && r0.invoiceAmount ? ` — ${money(r0.invoiceAmount)}` : ""}
                  </div>
                  {r0.invoiceDocUrl && (
                    <a href={r0.invoiceDocUrl} target="_blank" rel="noopener noreferrer" className="text-[11.5px] text-blue font-semibold whitespace-nowrap">Ver documento</a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
