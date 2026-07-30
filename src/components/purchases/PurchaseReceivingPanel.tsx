"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2 } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";

type Row = {
  id: string;
  groupId: string;
  status: "PAID" | "RECEIVED";
  quantity: number;
  totalCost: number;
  catalogItem: { name: string };
  supplier: { name: string };
};

function groupRows(rows: Row[]) {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    if (!map.has(r.groupId)) map.set(r.groupId, []);
    map.get(r.groupId)!.push(r);
  }
  return [...map.values()];
}

export function PurchaseReceivingPanel() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [urgentId, setUrgentId] = useState<string | null>(null);
  const [receivedQty, setReceivedQty] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const onPastePhoto = usePasteFile((file) => addPhoto(file));
  const [comment, setComment] = useState("");
  const [urgentType, setUrgentType] = useState<"DAMAGED_INCOMPLETE" | "NOT_ARRIVED">("DAMAGED_INCOMPLETE");
  const [urgentQty, setUrgentQty] = useState("");
  const [urgentDesc, setUrgentDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/purchase-requests?view=receiving")
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows)
      .catch(() => setRows([]));
  }
  useEffect(load, []);

  async function addPhoto(file: File) {
    setUploadingPhoto(true);
    setErr("");
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-receipts");
    setUploadingPhoto(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setPhotoUrl(uploaded.url);
  }

  async function confirmReceipt(id: string) {
    if (!photoUrl || !receivedQty) {
      setErr("Falta la cantidad recibida y la foto.");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/${id}/receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receivedQuantity: Number(receivedQty), photoUrl, comment: comment.trim() || undefined }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo confirmar.");
      return;
    }
    setOpenId(null);
    setReceivedQty("");
    setPhotoUrl(null);
    setComment("");
    load();
    router.refresh();
  }

  async function submitUrgent(id: string) {
    if (!urgentDesc.trim()) {
      setErr("Describe brevemente qué pasó.");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/${id}/urgent-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: urgentType, affectedQuantity: urgentQty ? Number(urgentQty) : undefined, description: urgentDesc.trim() }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo enviar el reporte.");
      return;
    }
    setUrgentId(null);
    setUrgentDesc("");
    setUrgentQty("");
    load();
  }

  if (!rows) return <div className="text-steel text-[13px]">Cargando…</div>;
  if (rows.length === 0) return <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13.5px]">No hay mercadería pagada esperando confirmación.</div>;

  const groups = groupRows(rows);

  return (
    <div className="flex flex-col gap-2.5">
      {groups.map((g) => {
        const groupId = g[0].groupId;
        const receivedCount = g.filter((r) => r.status === "RECEIVED").length;
        const isMulti = g.length > 1;
        const pendingNames = g.filter((r) => r.status === "PAID").map((r) => r.catalogItem.name);
        return (
          <div key={groupId} className="bg-surface border border-rule rounded-md p-4">
            {isMulti && (
              <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-rule">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-steel">
                  Cotización de {g.length} productos · {g[0].supplier.name}
                </div>
                <div className="text-[11px] font-bold text-teal">{receivedCount}/{g.length} confirmados</div>
              </div>
            )}
            <div className="flex flex-col gap-3">
              {g.map((r) => (
                <div key={r.id}>
                  <div className="flex items-center justify-between gap-3 flex-wrap mb-0.5">
                    <div className="text-[14px] font-bold">{r.catalogItem.name}</div>
                    {r.status === "RECEIVED" ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-green/15 text-green border border-green/40 rounded-full px-2.5 py-1">
                        <CheckCircle2 size={11} /> Recibido
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase tracking-wide bg-gold/15 border border-gold/40 rounded-full px-2.5 py-1" style={{ color: "#D9A441" }}>
                        Pendiente
                      </span>
                    )}
                  </div>
                  {!isMulti && <div className="text-[11.5px] text-steel mb-1">{r.supplier.name} — se pidieron y pagaron {r.quantity} un. · ${r.totalCost.toFixed(2)}</div>}
                  {isMulti && <div className="text-[11.5px] text-steel mb-1">{r.quantity} un. · ${r.totalCost.toFixed(2)}</div>}

                  {r.status === "PAID" && (
                    <>
                      {openId === r.id ? (
                        <div className="mt-2">
                          <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                            <div>
                              <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Cantidad recibida</label>
                              <input type="number" className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]" value={receivedQty} onChange={(e) => setReceivedQty(e.target.value)} />
                            </div>
                            <div>
                              <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Foto de lo recibido</label>
                              {photoUrl ? (
                                <img src={photoUrl} alt="" className="w-full h-9 rounded object-cover border border-rule" />
                              ) : (
                                <label
                                  tabIndex={0}
                                  onPaste={onPastePhoto}
                                  className="flex items-center justify-center gap-1.5 border-[1.5px] border-dashed border-rule rounded px-2.5 py-2 text-[12px] text-steel cursor-pointer hover:border-teal focus:border-teal focus:outline-none"
                                >
                                  {uploadingPhoto ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Camera size={13} />} Subir o pegar
                                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && addPhoto(e.target.files[0])} />
                                </label>
                              )}
                            </div>
                          </div>
                          <textarea className="w-full rounded border border-rule px-2.5 py-2 text-[12.5px] mb-2.5" rows={2} placeholder="Comentario breve (opcional)" value={comment} onChange={(e) => setComment(e.target.value)} />
                          {err && <div className="text-red text-[12px] mb-2">{err}</div>}
                          <div className="flex items-center gap-2">
                            <button type="button" disabled={busy} className="rounded border border-green bg-green px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => confirmReceipt(r.id)}>
                              ✓ Confirmar que llegó
                            </button>
                            <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={() => setOpenId(null)}>Cancelar</button>
                          </div>
                        </div>
                      ) : urgentId === r.id ? (
                        <div className="mt-2">
                          <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                            <select className="rounded border border-rule bg-surface px-2.5 py-2 text-[13px]" value={urgentType} onChange={(e) => setUrgentType(e.target.value as typeof urgentType)}>
                              <option value="DAMAGED_INCOMPLETE">Dañada o incompleta</option>
                              <option value="NOT_ARRIVED">Todavía no ha llegado</option>
                            </select>
                            {urgentType === "DAMAGED_INCOMPLETE" && (
                              <input type="number" placeholder="Cantidad afectada" className="rounded border border-rule px-2.5 py-2 text-[13px]" value={urgentQty} onChange={(e) => setUrgentQty(e.target.value)} />
                            )}
                          </div>
                          <textarea className="w-full rounded border border-rule px-2.5 py-2 text-[12.5px] mb-2.5" rows={2} placeholder="Describe qué pasó" value={urgentDesc} onChange={(e) => setUrgentDesc(e.target.value)} />
                          {err && <div className="text-red text-[12px] mb-2">{err}</div>}
                          <div className="flex items-center gap-2">
                            <button type="button" disabled={busy} className="rounded border border-red bg-red px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => submitUrgent(r.id)}>
                              Enviar reporte
                            </button>
                            <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={() => setUrgentId(null)}>Cancelar</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mt-1.5">
                          <button type="button" className="text-[11.5px] font-semibold border border-red/50 text-red rounded px-3 py-1.5 cursor-pointer" onClick={() => { setUrgentId(r.id); setErr(""); }}>
                            🚨 Informar urgente
                          </button>
                          <button type="button" className="rounded border border-green bg-green px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer" onClick={() => { setOpenId(r.id); setPhotoUrl(null); setReceivedQty(""); setComment(""); setErr(""); }}>
                            ✓ Confirmar que llegó
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
            {isMulti && pendingNames.length > 0 && (
              <div className="text-[11px] text-steel mt-3 pt-3 border-t border-rule">
                Todavía esperando: {pendingNames.join(", ")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
