"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, X, AlertTriangle, Truck } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";
import { actorName } from "@/lib/actorName";
import { PurchaseOperationDocuments, type OperationDocRow } from "./PurchaseOperationDocuments";

type Row = {
  id: string;
  groupId: string;
  status: "PAID" | "RECEIVED";
  quantity: number;
  unitCost: number;
  totalCost: number;
  paidAt: string | null;
  catalogItem: { name: string; photos: string[] };
  supplier: { name: string };
  requestedBy: { name: string } | null;
  paidBy: { name: string } | null;
  invoicedBy: { name: string } | null;
  quoteImageUrl: string;
  purchaseOrderUrl: string | null;
  paymentProofUrl: string | null;
  shippingPaymentProofUrl: string | null;
  invoiceDocUrl: string | null;
  receipt: {
    photoUrls: string[];
    receivedQuantity: number;
    aiPhotoMatch: boolean | null;
    aiPhotoNote: string | null;
    confirmedBy: { name: string } | null;
  } | null;
  // Fix confirmado 2026-08-11: reportado por el usuario — sin esto, el
  // botón "Informar urgente" volvía a mostrar el formulario vacío como si
  // nunca se hubiera reportado nada, permitiendo reportar dos veces el
  // mismo incidente.
  urgentReports: {
    id: string;
    damagedQty: number;
    incompleteQty: number;
    differentQty: number;
    missingQty: number;
    description: string;
    reportedAt: string;
    reportedBy: { name: string } | null;
  }[];
};

type PendingReplacement = {
  id: string;
  quantity: number;
  replacementDueDate: string | null;
  report: {
    request: { id: string; catalogItem: { name: string; photos: string[] }; supplier: { name: string } };
  };
};

function groupRows(rows: Row[]) {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    if (!map.has(r.groupId)) map.set(r.groupId, []);
    map.get(r.groupId)!.push(r);
  }
  return [...map.values()];
}

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

function isVideoUrl(url: string) {
  return /\.(mp4|mov|webm|avi|m4v)($|\?)/i.test(url);
}

const CREDIT_CLAIM_WINDOW_DAYS = 7;

export function PurchaseReceivingPanel() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [urgentId, setUrgentId] = useState<string | null>(null);
  const [receivedQty, setReceivedQty] = useState("");
  const [receivedPhotoUrls, setReceivedPhotoUrls] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [aiChecking, setAiChecking] = useState(false);
  const [aiResult, setAiResult] = useState<{ likelyMatch: boolean | null; note: string } | null>(null);
  const { onPaste: onPastePhoto, onMouseEnter: onPasteHoverIn, onMouseLeave: onPasteHoverOut } = usePasteFile((file) => addPhoto(file));
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Informar urgente — cantidades desglosadas por tipo + evidencia.
  const [urgentDamagedQty, setUrgentDamagedQty] = useState("");
  const [urgentDifferentQty, setUrgentDifferentQty] = useState("");
  const [urgentIncompleteQty, setUrgentIncompleteQty] = useState("");
  const [urgentDesc, setUrgentDesc] = useState("");
  const [urgentMediaUrls, setUrgentMediaUrls] = useState<string[]>([]);
  const [uploadingUrgentMedia, setUploadingUrgentMedia] = useState(false);
  const { onPaste: onPasteUrgentMedia, onMouseEnter: onUrgentMediaHoverIn, onMouseLeave: onUrgentMediaHoverOut } = usePasteFile((file) => addUrgentMedia(file));

  const [pendingReplacements, setPendingReplacements] = useState<PendingReplacement[]>([]);
  const [openReplacementId, setOpenReplacementId] = useState<string | null>(null);
  const [replacementPhotoUrls, setReplacementPhotoUrls] = useState<string[]>([]);
  const [uploadingReplacementPhoto, setUploadingReplacementPhoto] = useState(false);
  const { onPaste: onPasteReplacement, onMouseEnter: onReplacementHoverIn, onMouseLeave: onReplacementHoverOut } = usePasteFile((file) => addReplacementPhoto(file));

  function load() {
    fetch("/api/purchase-requests?view=receiving").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
    fetch("/api/purchase-requests/urgent-resolutions/pending-replacements").then((r) => (r.ok ? r.json() : [])).then(setPendingReplacements).catch(() => setPendingReplacements([]));
  }
  useEffect(load, []);

  async function addPhoto(file: File) {
    if (receivedPhotoUrls.length >= 3) return;
    setUploadingPhoto(true);
    setErr("");
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-request-receipts");
    setUploadingPhoto(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    const next = [...receivedPhotoUrls, uploaded.url];
    setReceivedPhotoUrls(next);
    // Confirmado 2026-08-06: apenas hay 2 fotos, la IA las compara contra las
    // de referencia del catálogo — apoyo visual, nunca bloquea la confirmación.
    if (next.length >= 2 && openId) verifyPhotos(openId, next);
  }

  function removePhoto(idx: number) {
    setReceivedPhotoUrls((ps) => ps.filter((_, i) => i !== idx));
    setAiResult(null);
  }

  async function verifyPhotos(requestId: string, photos: string[]) {
    setAiChecking(true);
    setAiResult(null);
    const res = await fetch("/api/purchase-requests/verify-receipt-photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, receivedPhotoUrls: photos }),
    });
    setAiChecking(false);
    const data = await res.json().catch(() => null);
    if (res.ok) setAiResult(data);
  }

  async function confirmReceipt(id: string) {
    if (receivedPhotoUrls.length < 2 || !receivedQty) {
      setErr("Falta la cantidad recibida y al menos 2 fotos.");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/${id}/receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        receivedQuantity: Number(receivedQty),
        photoUrls: receivedPhotoUrls,
        comment: comment.trim() || undefined,
        aiPhotoMatch: aiResult?.likelyMatch ?? null,
        aiPhotoNote: aiResult?.note ?? null,
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo confirmar.");
      return;
    }
    setOpenId(null);
    setReceivedQty("");
    setReceivedPhotoUrls([]);
    setAiResult(null);
    setComment("");
    load();
    router.refresh();
  }

  function openUrgent(id: string) {
    setUrgentId(id);
    setUrgentDamagedQty("");
    setUrgentDifferentQty("");
    setUrgentIncompleteQty("");
    setUrgentDesc("");
    setUrgentMediaUrls([]);
    setErr("");
  }

  async function addUrgentMedia(file: File) {
    if (urgentMediaUrls.length >= 4) return;
    setUploadingUrgentMedia(true);
    setErr("");
    // Confirmado 2026-08-06: el video se sube tal cual (comprimir video de
    // verdad en el navegador no es viable sin una librería pesada) — el
    // límite de 15 MB de /api/upload/sign sigue aplicando igual.
    const toUpload = file.type.startsWith("image/") ? await compressImage(file) : file;
    const uploaded = await uploadFile(toUpload, "purchase-request-receipts");
    setUploadingUrgentMedia(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setUrgentMediaUrls((m) => [...m, uploaded.url]);
  }

  function removeUrgentMedia(idx: number) {
    setUrgentMediaUrls((m) => m.filter((_, i) => i !== idx));
  }

  async function submitUrgent(id: string) {
    const damaged = Number(urgentDamagedQty) || 0;
    const different = Number(urgentDifferentQty) || 0;
    const incomplete = Number(urgentIncompleteQty) || 0;
    if (damaged + different + incomplete <= 0) {
      setErr("Ingresa al menos una cantidad afectada.");
      return;
    }
    if (urgentMediaUrls.length === 0) {
      setErr("Sube al menos una foto de evidencia.");
      return;
    }
    if (!urgentDesc.trim()) {
      setErr("Describe brevemente qué pasó.");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/${id}/urgent-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ damagedQty: damaged, differentQty: different, incompleteQty: incomplete, description: urgentDesc.trim(), mediaUrls: urgentMediaUrls }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo enviar el reporte.");
      return;
    }
    setUrgentId(null);
    setUrgentDesc("");
    setUrgentMediaUrls([]);
    load();
  }

  async function addReplacementPhoto(file: File) {
    if (replacementPhotoUrls.length >= 3) return;
    setUploadingReplacementPhoto(true);
    setErr("");
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-request-receipts");
    setUploadingReplacementPhoto(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setReplacementPhotoUrls((p) => [...p, uploaded.url]);
  }

  async function confirmReplacement(resolutionId: string) {
    if (replacementPhotoUrls.length < 2) {
      setErr("Sube al menos 2 fotos.");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/urgent-resolutions/${resolutionId}/replacement-arrived`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoUrls: replacementPhotoUrls }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo confirmar.");
      return;
    }
    setOpenReplacementId(null);
    setReplacementPhotoUrls([]);
    load();
    router.refresh();
  }

  if (!rows) return <div className="text-steel text-[13px]">Cargando…</div>;

  const groups = groupRows(rows);

  return (
    <div className="flex flex-col gap-2.5">
      {pendingReplacements.length > 0 && (
        <div className="bg-surface border border-gold/40 rounded-md p-4 mb-1">
          <div className="flex items-center gap-1.5 text-[12px] font-bold mb-2" style={{ color: "#D9A441" }}>
            <Truck size={14} /> Cambios de mercadería pendientes de verificar
          </div>
          <div className="flex flex-col gap-2.5">
            {pendingReplacements.map((pr) => (
              <div key={pr.id} className="bg-cloud rounded-md p-3">
                <div className="text-[13px] font-bold">{pr.report.request.catalogItem.name}</div>
                <div className="text-[11.5px] text-steel mb-2">
                  {pr.report.request.supplier.name} — {pr.quantity} un. · llega hasta {pr.replacementDueDate ? new Date(pr.replacementDueDate).toLocaleDateString("es-MX") : "—"}
                </div>
                {openReplacementId === pr.id ? (
                  <div>
                    <div className="text-[11px] text-steel mb-1.5">Mínimo 2 fotos, igual que una recepción normal.</div>
                    <div className="grid grid-cols-3 gap-2 mb-2.5">
                      {replacementPhotoUrls.map((url, i) => (
                        <img key={i} src={url} alt="" className="w-full h-24 rounded object-cover border border-rule" />
                      ))}
                      {replacementPhotoUrls.length < 3 && (
                        <label
                          tabIndex={0}
                          onPaste={onPasteReplacement}
                          onMouseEnter={onReplacementHoverIn}
                          onMouseLeave={onReplacementHoverOut}
                          className="flex flex-col items-center justify-center gap-1 h-24 border-[1.5px] border-dashed border-rule rounded text-[11px] text-steel cursor-pointer hover:border-teal"
                        >
                          {uploadingReplacementPhoto ? <span className="w-4 h-4 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Camera size={16} />}
                          Subir o pegar
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && addReplacementPhoto(e.target.files[0])} />
                        </label>
                      )}
                    </div>
                    {err && <div className="text-red text-[12px] mb-2">{err}</div>}
                    <div className="flex items-center gap-2">
                      <button type="button" disabled={busy || replacementPhotoUrls.length < 2} className="rounded border border-green bg-green px-3.5 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => confirmReplacement(pr.id)}>
                        ✓ Confirmar que llegó bien
                      </button>
                      <button type="button" className="text-steel text-[12px] cursor-pointer" onClick={() => { setOpenReplacementId(null); setReplacementPhotoUrls([]); }}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="rounded border border-teal bg-teal px-3.5 py-1.5 text-[12px] font-bold text-navy cursor-pointer" onClick={() => { setOpenReplacementId(pr.id); setReplacementPhotoUrls([]); setErr(""); }}>
                    Verificar cambio recibido
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {rows.length === 0 && pendingReplacements.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13.5px]">No hay mercadería pagada esperando confirmación.</div>
      )}

      {groups.map((g) => {
        const groupId = g[0].groupId;
        const receivedCount = g.filter((r) => r.status === "RECEIVED").length;
        const isMulti = g.length > 1;
        const pendingNames = g.filter((r) => r.status === "PAID").map((r) => r.catalogItem.name);
        const missingPurchaseOrder = !g[0].purchaseOrderUrl;
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
            <div className="text-[10px] text-steel-dim mb-2">
              Solicitada por {actorName(g[0].requestedBy?.name)} · Pagada por {actorName(g[0].paidBy?.name)}
            </div>

            {missingPurchaseOrder && (
              <div className="flex items-center gap-2 bg-gold/10 border border-gold/35 rounded-md px-3 py-2 mb-3 text-[12px]" style={{ color: "#D9A441" }}>
                <AlertTriangle size={14} className="shrink-0" />
                Falta que suban la orden de compra — no se puede confirmar la recepción todavía.
              </div>
            )}

            <div className="flex flex-col gap-3 mb-3">
              {g.map((r) => {
                const creditDeadline = r.paidAt ? new Date(new Date(r.paidAt).getTime() + CREDIT_CLAIM_WINDOW_DAYS * 86400000) : null;
                const pastCreditWindow = creditDeadline ? new Date() > creditDeadline : false;
                const urgentTotal = (Number(urgentDamagedQty) || 0) + (Number(urgentDifferentQty) || 0) + (Number(urgentIncompleteQty) || 0);
                return (
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

                  {r.status === "PAID" && !missingPurchaseOrder && (
                    <>
                      {openId === r.id ? (
                        <div className="mt-2">
                          <div className="mb-2.5">
                            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Cantidad recibida — se pidieron {r.quantity} un.</label>
                            <input type="number" className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]" value={receivedQty} onChange={(e) => setReceivedQty(e.target.value)} />
                            {receivedQty !== "" && Number(receivedQty) !== r.quantity && (
                              <div className="flex items-center gap-1.5 text-[11px] text-red mt-1.5">
                                <AlertTriangle size={12} className="shrink-0" />
                                No coincide con lo pedido ({r.quantity} un.) — no se puede confirmar así. Usa &quot;🚨 Informar urgente&quot; para reportar la diferencia.
                              </div>
                            )}
                          </div>

                          {/* Confirmado 2026-08-08: antes solo se veía la nota de texto de la
                              IA — Daniel pedía ver las fotos de referencia del catálogo (las que
                              se subieron al registrar el producto) lado a lado con lo que él
                              sube, para comparar a simple vista ANTES de confirmar, no solo
                              confiar en el texto de la IA. */}
                          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
                            Fotos de referencia — como se registró el producto
                          </label>
                          {r.catalogItem.photos.length > 0 ? (
                            <div className="grid grid-cols-3 gap-2 mb-3">
                              {r.catalogItem.photos.map((url, i) => (
                                <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="bg-cloud rounded border border-teal/40 flex items-center justify-center h-56">
                                  <img src={url} alt="" className="max-w-full max-h-full object-contain" />
                                </a>
                              ))}
                            </div>
                          ) : (
                            <div className="text-[11px] text-steel-dim mb-3">Este producto no tiene fotos de referencia registradas en el catálogo.</div>
                          )}

                          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
                            Fotos de lo recibido ({receivedPhotoUrls.length}/3, mínimo 2)
                          </label>
                          <div className="text-[11px] text-steel mb-2">
                            Foto 1: el producto encima o junto al cartón del bulto. Foto 2: el cartón abierto con una unidad de muestra encima, junto al bulto —
                            compáralas contra las de referencia de arriba antes de confirmar; la IA también las revisa apenas subas la 2da.
                          </div>

                          <div className="grid grid-cols-3 gap-2 mb-2.5">
                            {receivedPhotoUrls.map((url, i) => (
                              <div key={i} className="relative">
                                <a href={url} target="_blank" rel="noopener noreferrer" className="bg-cloud rounded border border-rule flex items-center justify-center h-56">
                                  <img src={url} alt="" className="max-w-full max-h-full object-contain" />
                                </a>
                                <button
                                  type="button"
                                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red text-white flex items-center justify-center cursor-pointer"
                                  onClick={() => removePhoto(i)}
                                >
                                  <X size={11} />
                                </button>
                              </div>
                            ))}
                            {receivedPhotoUrls.length < 3 && (
                              <label
                                tabIndex={0}
                                onPaste={onPastePhoto}
                                onMouseEnter={onPasteHoverIn}
                                onMouseLeave={onPasteHoverOut}
                                className="flex flex-col items-center justify-center gap-1 h-56 border-[1.5px] border-dashed border-rule rounded text-[11px] text-steel cursor-pointer hover:border-teal focus:border-teal focus:outline-none"
                              >
                                {uploadingPhoto ? <span className="w-4 h-4 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Camera size={16} />}
                                Subir o pegar
                                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && addPhoto(e.target.files[0])} />
                              </label>
                            )}
                          </div>

                          {aiChecking && <div className="text-[11.5px] text-steel mb-2">🤖 Comparando con las fotos de referencia del catálogo…</div>}
                          {aiResult && (
                            <div className={`flex items-start gap-1.5 text-[11.5px] mb-1 ${aiResult.likelyMatch ? "text-teal" : "text-red font-semibold"}`}>
                              🤖 {aiResult.note}
                            </div>
                          )}
                          {/* Confirmado 2026-08-08: cambio de política pedido explícitamente
                              por el usuario — antes la IA era solo apoyo visual y nunca
                              bloqueaba; ahora si detecta que el producto NO corresponde, o si
                              la cantidad recibida no coincide con lo pedido, "Confirmar que
                              llegó" se deshabilita del todo — la única salida es "Informar
                              urgente" (que sí manda notificación con la novedad real). */}
                          {aiResult && aiResult.likelyMatch === false && (
                            <div className="text-[11px] text-red mb-2.5">
                              No se puede confirmar así — si de verdad llegó un producto distinto, usa &quot;🚨 Informar urgente&quot; (categoría Diferente) en vez de este botón.
                            </div>
                          )}

                          <textarea className="w-full rounded border border-rule px-2.5 py-2 text-[12.5px] mb-2.5" rows={2} placeholder="Comentario breve (opcional)" value={comment} onChange={(e) => setComment(e.target.value)} />
                          {err && <div className="text-red text-[12px] mb-2">{err}</div>}
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={
                                busy ||
                                receivedPhotoUrls.length < 2 ||
                                !receivedQty ||
                                Number(receivedQty) !== r.quantity ||
                                aiResult?.likelyMatch === false
                              }
                              className="rounded border border-green bg-green px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
                              onClick={() => confirmReceipt(r.id)}
                            >
                              ✓ Confirmar que llegó
                            </button>
                            <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={() => { setOpenId(null); setReceivedPhotoUrls([]); setAiResult(null); }}>Cancelar</button>
                          </div>
                        </div>
                      ) : urgentId === r.id ? (
                        <div className="mt-2">
                          {creditDeadline && (
                            <div className={`flex items-center gap-1.5 text-[11px] mb-2.5 ${pastCreditWindow ? "text-red" : "text-steel"}`}>
                              <AlertTriangle size={12} />
                              {pastCreditWindow
                                ? `Ya pasaron los 7 días desde el pago (venció ${creditDeadline.toLocaleDateString("es-MX")}) — el proveedor puede no aprobar crédito por esto.`
                                : `Tienes hasta ${creditDeadline.toLocaleDateString("es-MX")} (7 días desde el pago) para que el proveedor apruebe crédito.`}
                            </div>
                          )}
                          {/* Confirmado 2026-08-08: mismo pedido que "Confirmar que llegó" —
                              ver las fotos de referencia del catálogo ayuda a confirmar que lo
                              dañado/incompleto que llegó de verdad corresponde a lo que se pidió,
                              no un producto distinto por error del proveedor. */}
                          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
                            Fotos de referencia — como se registró el producto
                          </label>
                          {r.catalogItem.photos.length > 0 ? (
                            <div className="grid grid-cols-3 gap-2 mb-3">
                              {r.catalogItem.photos.map((url, i) => (
                                <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="bg-cloud rounded border border-teal/40 flex items-center justify-center h-48">
                                  <img src={url} alt="" className="max-w-full max-h-full object-contain" />
                                </a>
                              ))}
                            </div>
                          ) : (
                            <div className="text-[11px] text-steel-dim mb-3">Este producto no tiene fotos de referencia registradas en el catálogo.</div>
                          )}

                          <div className="grid grid-cols-3 gap-2.5 mb-2.5">
                            <div>
                              <label className="block mb-1 text-[10px] text-steel">Dañada</label>
                              <input type="number" min={0} className="w-full rounded border border-rule px-2 py-2 text-[13px]" value={urgentDamagedQty} onChange={(e) => setUrgentDamagedQty(e.target.value)} />
                            </div>
                            <div>
                              <label className="block mb-1 text-[10px] text-steel">Incompleta</label>
                              <input type="number" min={0} className="w-full rounded border border-rule px-2 py-2 text-[13px]" value={urgentIncompleteQty} onChange={(e) => setUrgentIncompleteQty(e.target.value)} />
                            </div>
                            <div>
                              <label className="block mb-1 text-[10px] text-steel">Diferente</label>
                              <input type="number" min={0} className="w-full rounded border border-rule px-2 py-2 text-[13px]" value={urgentDifferentQty} onChange={(e) => setUrgentDifferentQty(e.target.value)} />
                            </div>
                          </div>
                          {urgentTotal > 0 && (
                            <div className="text-[12px] font-semibold text-ink mb-2.5">
                              {urgentTotal} un. afectadas · ${(urgentTotal * r.unitCost).toFixed(2)} en disputa (costo de la cotización)
                            </div>
                          )}

                          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
                            Evidencia ({urgentMediaUrls.length}/4) — mínimo 1 foto, puedes agregar 1 video
                          </label>
                          <div className="grid grid-cols-4 gap-2 mb-2.5">
                            {urgentMediaUrls.map((url, i) => (
                              <div key={i} className="relative">
                                {isVideoUrl(url) ? (
                                  <video src={url} controls className="w-full h-48 rounded object-contain border border-rule bg-cloud" />
                                ) : (
                                  <a href={url} target="_blank" rel="noopener noreferrer" className="bg-cloud rounded border border-rule flex items-center justify-center h-48">
                                    <img src={url} alt="" className="max-w-full max-h-full object-contain" />
                                  </a>
                                )}
                                <button type="button" className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red text-white flex items-center justify-center cursor-pointer" onClick={() => removeUrgentMedia(i)}>
                                  <X size={11} />
                                </button>
                              </div>
                            ))}
                            {urgentMediaUrls.length < 4 && (
                              <label
                                tabIndex={0}
                                onPaste={onPasteUrgentMedia}
                                onMouseEnter={onUrgentMediaHoverIn}
                                onMouseLeave={onUrgentMediaHoverOut}
                                className="flex flex-col items-center justify-center gap-1 h-48 border-[1.5px] border-dashed border-red/40 rounded text-[10.5px] text-red cursor-pointer hover:border-red"
                              >
                                {uploadingUrgentMedia ? <span className="w-4 h-4 rounded-full border-2 border-rule border-t-red animate-spin" /> : <Camera size={15} />}
                                Foto o video
                                <input type="file" accept="image/*,video/*" className="hidden" onChange={(e) => e.target.files?.[0] && addUrgentMedia(e.target.files[0])} />
                              </label>
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
                        <div className="mt-1.5">
                          {r.urgentReports.length > 0 && (
                            <div className="bg-red/10 border border-red/30 rounded-md p-3 mb-2">
                              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-red mb-1.5">
                                <AlertTriangle size={13} /> Reporte urgente ya enviado — no se puede volver a reportar
                              </div>
                              {r.urgentReports.map((rep) => {
                                const parts = [
                                  rep.damagedQty > 0 && `${rep.damagedQty} dañada`,
                                  rep.incompleteQty > 0 && `${rep.incompleteQty} incompleta`,
                                  rep.differentQty > 0 && `${rep.differentQty} diferente`,
                                  rep.missingQty > 0 && `${rep.missingQty} faltante`,
                                ].filter(Boolean) as string[];
                                return (
                                  <div key={rep.id} className="text-[11.5px] text-steel mb-1.5 last:mb-0">
                                    {parts.join(" · ")}{rep.description ? ` — "${rep.description}"` : ""}
                                    <div className="text-[10px] text-steel-dim">
                                      Reportado por {actorName(rep.reportedBy?.name)} · {new Date(rep.reportedAt).toLocaleDateString("es-MX")}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            {r.urgentReports.length === 0 && (
                              <button type="button" className="text-[11.5px] font-semibold border border-red/50 text-red rounded px-3 py-1.5 cursor-pointer" onClick={() => openUrgent(r.id)}>
                                🚨 Informar urgente
                              </button>
                            )}
                            <button type="button" className="rounded border border-green bg-green px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer" onClick={() => { setOpenId(r.id); setReceivedPhotoUrls([]); setAiResult(null); setReceivedQty(""); setComment(""); setErr(""); }}>
                              ✓ Confirmar que llegó
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
                );
              })}
            </div>
            {isMulti && pendingNames.length > 0 && (
              <div className="text-[11px] text-steel mb-3 pb-3 border-b border-rule">
                Todavía esperando: {pendingNames.join(", ")}
              </div>
            )}

            <PurchaseOperationDocuments rows={g.map(toDocRow)} />
          </div>
        );
      })}
    </div>
  );
}
