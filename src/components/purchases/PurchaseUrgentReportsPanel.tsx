"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Wallet, Upload } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";
import { actorName } from "@/lib/actorName";

type Report = {
  id: string;
  type: "DAMAGED_INCOMPLETE" | "NOT_ARRIVED";
  affectedQuantity: number | null;
  description: string;
  reportedAt: string;
  reportedBy: { name: string } | null;
  resolvedAt: string | null;
  resolution: string | null;
  request: { quantity: number; totalCost: number; catalogItem: { name: string }; supplier: { id: string; name: string } };
  credit: { amount: number; status: "AVAILABLE" | "APPLIED" | "REFUNDED"; refundProofUrl: string | null } | null;
};

const TYPE_LABELS: Record<Report["type"], string> = {
  DAMAGED_INCOMPLETE: "Dañada o incompleta",
  NOT_ARRIVED: "Nunca llegó",
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Confirmado 2026-08-06: dónde el admin resuelve cada "🚨 Informar urgente"
// que Daniel manda — sin esto la mercadería ya pagada y dañada/incompleta
// no dejaba ningún rastro de qué se hizo con el proveedor. Tres desenlaces:
// crédito para la siguiente compra, reembolso ya recibido (con comprobante),
// o ninguna acción (con una nota de por qué).
export function PurchaseUrgentReportsPanel() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [action, setAction] = useState<"credit" | "refund" | "none">("credit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [refundProofUrl, setRefundProofUrl] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const { onPaste, onMouseEnter, onMouseLeave } = usePasteFile((file) => uploadProof(file));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/purchase-requests/urgent-reports").then((r) => (r.ok ? r.json() : [])).then(setReports).catch(() => setReports([]));
  }
  useEffect(load, []);

  async function uploadProof(file: File) {
    setUploadingProof(true);
    setErr("");
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-payments");
    setUploadingProof(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setRefundProofUrl(uploaded.url);
  }

  function openResolve(r: Report) {
    setOpenId(r.id);
    setAction("credit");
    setAmount(r.request.totalCost > 0 ? String(r.request.totalCost) : "");
    setReason("");
    setRefundProofUrl(null);
    setErr("");
  }

  async function resolve(id: string) {
    if (action !== "none" && (!amount || Number(amount) <= 0)) { setErr("Ingresa un monto válido."); return; }
    if (action === "refund" && !refundProofUrl) { setErr("Sube el comprobante del reembolso."); return; }
    if (!reason.trim()) { setErr("Explica brevemente qué se decidió."); return; }
    setBusy(true);
    setErr("");
    const body =
      action === "credit" ? { action, amount: Number(amount), reason: reason.trim() }
      : action === "refund" ? { action, amount: Number(amount), reason: reason.trim(), refundProofUrl }
      : { action, reason: reason.trim() };
    const res = await fetch(`/api/purchase-requests/urgent-reports/${id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo resolver."); return; }
    setOpenId(null);
    load();
    router.refresh();
  }

  if (!reports) return <div className="text-steel text-[13px]">Cargando…</div>;
  if (reports.length === 0) return <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13.5px]">No hay reportes urgentes todavía.</div>;

  const pending = reports.filter((r) => !r.resolvedAt);
  const resolved = reports.filter((r) => r.resolvedAt);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Pendientes de resolver ({pending.length})</div>
        {pending.length === 0 && <div className="text-steel text-[12.5px]">Nada pendiente — todo resuelto.</div>}
        <div className="flex flex-col gap-2.5">
          {pending.map((r) => (
            <div key={r.id} className="bg-surface border border-red/40 rounded-md p-4">
              <div className="flex items-center gap-1.5 text-[12px] font-bold text-red mb-1"><AlertTriangle size={13} /> {TYPE_LABELS[r.type]}</div>
              <div className="text-[13.5px] font-bold">{r.request.catalogItem.name}</div>
              <div className="text-[11.5px] text-steel mb-1">{r.request.supplier.name} — pagado {money(r.request.totalCost)} · {r.request.quantity} un. pedidas{r.affectedQuantity ? ` · ${r.affectedQuantity} un. afectadas` : ""}</div>
              <div className="text-[12px] mb-2">{r.description}</div>
              <div className="text-[10px] text-steel-dim mb-2.5">Reportado por {actorName(r.reportedBy?.name)} · {new Date(r.reportedAt).toLocaleString("es-MX")}</div>

              {openId === r.id ? (
                <div className="bg-cloud rounded-md p-3">
                  <div className="flex gap-2 mb-2.5">
                    {([["credit", "Crédito futuro"], ["refund", "Ya reembolsó"], ["none", "Sin acción"]] as const).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        className={`flex-1 rounded border py-1.5 text-[11.5px] font-semibold cursor-pointer ${action === k ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}
                        onClick={() => setAction(k)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {action !== "none" && (
                    <div className="mb-2.5">
                      <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Monto</label>
                      <input type="number" step="0.01" className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]" value={amount} onChange={(e) => setAmount(e.target.value)} />
                    </div>
                  )}

                  {action === "refund" && (
                    <div className="mb-2.5">
                      <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Comprobante del reembolso</label>
                      {refundProofUrl ? (
                        <div className="flex items-center gap-1.5 text-[11.5px] text-teal"><CheckCircle2 size={13} /> Subido <button type="button" className="text-steel underline ml-1 cursor-pointer" onClick={() => setRefundProofUrl(null)}>cambiar</button></div>
                      ) : (
                        <label tabIndex={0} onPaste={onPaste} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} className="flex items-center gap-1.5 border-[1.5px] border-dashed border-rule rounded px-2.5 py-2 text-[12px] text-steel cursor-pointer hover:border-teal focus:border-teal focus:outline-none w-fit">
                          {uploadingProof ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={13} />} Subir o pegar
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadProof(e.target.files[0])} />
                        </label>
                      )}
                    </div>
                  )}

                  <textarea className="w-full rounded border border-rule px-2.5 py-2 text-[12.5px] mb-2.5" rows={2} placeholder={action === "none" ? "¿Por qué no hace falta ninguna acción?" : "Nota breve (ej. acordado con el proveedor por WhatsApp)"} value={reason} onChange={(e) => setReason(e.target.value)} />
                  {err && <div className="text-red text-[12px] mb-2">{err}</div>}
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={busy} className="rounded border border-green bg-green px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => resolve(r.id)}>
                      Resolver
                    </button>
                    <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={() => setOpenId(null)}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer" onClick={() => openResolve(r)}>
                  Resolver con el proveedor
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {resolved.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Resueltos</div>
          <div className="flex flex-col gap-2">
            {resolved.map((r) => (
              <div key={r.id} className="bg-surface border border-rule rounded-md p-3.5 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">{r.request.catalogItem.name} — {r.request.supplier.name}</div>
                  {r.credit ? (
                    <span className="flex items-center gap-1 font-semibold" style={{ color: r.credit.status === "AVAILABLE" ? "#D9A441" : "#22a67e" }}>
                      <Wallet size={12} />
                      {r.credit.status === "AVAILABLE" ? `Crédito disponible ${money(r.credit.amount)}` : r.credit.status === "APPLIED" ? `Crédito aplicado ${money(r.credit.amount)}` : `Reembolsado ${money(r.credit.amount)}`}
                    </span>
                  ) : (
                    <span className="text-steel">Sin acción con el proveedor</span>
                  )}
                </div>
                <div className="text-steel mt-0.5">{r.resolution}</div>
                {r.credit?.refundProofUrl && (
                  <a href={r.credit.refundProofUrl} target="_blank" rel="noopener noreferrer" className="text-blue font-semibold">Ver comprobante</a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
