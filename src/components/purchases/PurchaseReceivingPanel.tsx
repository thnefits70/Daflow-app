"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, X, AlertTriangle, Truck } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { actorName } from "@/lib/actorName";
import { LiveCameraCapture } from "@/components/shared/LiveCameraCapture";
import { PurchaseOperationDocuments, type OperationDocRow } from "./PurchaseOperationDocuments";

type Row = {
  id: string;
  groupId: string;
  status: "PAID" | "RECEIVED_PENDING_REVIEW" | "RECEIVED";
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
    videoUrls: string[];
    receivedQuantity: number;
    comment: string | null;
    aiPhotoMatch: boolean | null;
    aiPhotoNote: string | null;
    confirmedBy: { name: string } | null;
    confirmedAt: string;
    approvedBy: { name: string } | null;
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

// Confirmado 2026-08-18: cola de Daniel — "Informar urgente" que su equipo
// subió y todavía no revisó (ver urgent-reports/pending-review/route.ts).
type PendingUrgentReport = {
  id: string;
  damagedQty: number;
  incompleteQty: number;
  differentQty: number;
  missingQty: number;
  description: string;
  mediaUrls: string[];
  reportedAt: string;
  reportedBy: { name: string } | null;
  request: {
    quantity: number;
    unitCost: number;
    totalCost: number;
    catalogItem: { name: string; photos: string[] };
    supplier: { name: string };
  };
};

type PendingReplacement = {
  id: string;
  quantity: number;
  replacementDueDate: string | null;
  // Confirmado 2026-08-18: pedido explícito del usuario — mismo patrón de
  // equipo/Daniel que la recepción normal. Mientras replacementSubmittedAt
  // sea null, falta que el equipo suba fotos; con valor, falta que Daniel
  // apruebe (ver approve-replacement/route.ts).
  replacementSubmittedAt: string | null;
  replacementSubmittedBy: { name: string } | null;
  replacementPhotoUrls: string[];
  replacementAiMatch: boolean | null;
  replacementAiNote: string | null;
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

// Confirmado 2026-08-11: si ya hay un reporte urgente sobre esta solicitud,
// lo que se puede confirmar como "recibido" es solo la cantidad buena (lo
// pedido menos lo reportado dañado/incompleto/diferente) — lo demás sigue
// su propio proceso de reemplazo/reembolso/crédito, sin bloquear la venta
// de lo que sí llegó bien.
function goodQuantity(r: Row): number {
  const affected = r.urgentReports.reduce((s, rep) => s + rep.damagedQty + rep.incompleteQty + rep.differentQty + rep.missingQty, 0);
  return r.quantity - affected;
}

const CREDIT_CLAIM_WINDOW_DAYS = 7;

// Fix confirmado 2026-08-11 (ampliado 2026-08-18): admin puede ver esta
// pestaña (para supervisar) pero nunca debe poder recibir, aprobar,
// informar urgente, ni verificar cambios recibidos — eso es del equipo de
// Inventario (recibir/informar) y de Daniel (aprobar/verificar cambios). Los
// botones quedan visibles pero deshabilitados para admin, nunca ocultos del
// todo (así sabe que existen, solo no los puede usar). El servidor también
// lo bloquea (canReceivePurchasesTeam/canActOnPurchaseReceiving), así que
// esto no es solo cosmético.
export function PurchaseReceivingPanel({ isAdmin = false, canReceiveTeam = false, canApprove = false }: { isAdmin?: boolean; canReceiveTeam?: boolean; canApprove?: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [urgentId, setUrgentId] = useState<string | null>(null);
  const [receivedQty, setReceivedQty] = useState("");
  const [receivedPhotoUrls, setReceivedPhotoUrls] = useState<string[]>([]);
  const [takingPhoto, setTakingPhoto] = useState(false);
  const [aiChecking, setAiChecking] = useState(false);
  const [aiResult, setAiResult] = useState<{ likelyMatch: boolean | null; note: string; minorDifferenceOnly?: boolean } | null>(null);
  const [minorDifferenceConfirmed, setMinorDifferenceConfirmed] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Confirmado 2026-08-18 (ampliado el mismo día): pedido explícito del
  // usuario — la foto obligatoria SOLO se puede tomar en vivo dentro de esta
  // pantalla (LiveCameraCapture, con getUserMedia + canvas), nunca elegida de
  // galería/portapapeles — así se garantiza que es del momento real, no una
  // foto vieja o de otro producto. Video de evidencia ADEMÁS de la foto,
  // opcional, útil sobre todo cuando llegan muchos bultos — pero el atributo
  // `capture` del input nativo solo lo respeta el celular (en laptop cae al
  // explorador de archivos normal), así que esa opción solo se ofrece si
  // isMobileDevice.
  const [receivedVideoUrls, setReceivedVideoUrls] = useState<string[]>([]);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const videoCameraInputRef = useRef<HTMLInputElement>(null);
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  useEffect(() => {
    setIsMobileDevice(/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));
  }, []);

  // Cola de Daniel: "Informar urgente" que el equipo subió y todavía no revisó.
  const [pendingUrgentReports, setPendingUrgentReports] = useState<PendingUrgentReport[]>([]);

  // Informar urgente — cantidades desglosadas por tipo + evidencia.
  const [urgentDamagedQty, setUrgentDamagedQty] = useState("");
  const [urgentDifferentQty, setUrgentDifferentQty] = useState("");
  const [urgentIncompleteQty, setUrgentIncompleteQty] = useState("");
  const [urgentDesc, setUrgentDesc] = useState("");
  const [urgentMediaUrls, setUrgentMediaUrls] = useState<string[]>([]);
  const [takingUrgentPhoto, setTakingUrgentPhoto] = useState(false);
  const [uploadingUrgentMedia, setUploadingUrgentMedia] = useState(false);

  const [pendingReplacements, setPendingReplacements] = useState<PendingReplacement[]>([]);
  const [openReplacementId, setOpenReplacementId] = useState<string | null>(null);
  const [replacementPhotoUrls, setReplacementPhotoUrls] = useState<string[]>([]);
  const [takingReplacementPhoto, setTakingReplacementPhoto] = useState(false);

  function load() {
    fetch("/api/purchase-requests?view=receiving").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
    fetch("/api/purchase-requests/urgent-resolutions/pending-replacements").then((r) => (r.ok ? r.json() : [])).then(setPendingReplacements).catch(() => setPendingReplacements([]));
    if (canApprove) {
      fetch("/api/purchase-requests/urgent-reports/pending-review").then((r) => (r.ok ? r.json() : [])).then(setPendingUrgentReports).catch(() => setPendingUrgentReports([]));
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [canApprove]);

  // Confirmado 2026-08-18: LiveCameraCapture ya sube el archivo (comprime +
  // uploadFile internamente) y entrega la URL final — acá solo se agrega al
  // arreglo y se dispara la verificación de IA, mismo criterio de siempre.
  function handlePhotoCaptured(url: string) {
    const next = [...receivedPhotoUrls, url];
    setReceivedPhotoUrls(next);
    setTakingPhoto(false);
    // Confirmado 2026-08-06: apenas hay 2 fotos, la IA las compara contra las
    // de referencia del catálogo — apoyo visual, nunca bloquea la confirmación.
    if (next.length >= 2 && openId) verifyPhotos(openId, next);
  }

  function removePhoto(idx: number) {
    setReceivedPhotoUrls((ps) => ps.filter((_, i) => i !== idx));
    setAiResult(null);
    setMinorDifferenceConfirmed(false);
  }

  // Confirmado 2026-08-18: video no se comprime (no es viable en el
  // navegador sin una librería pesada) — mismo criterio que ya usa
  // addUrgentMedia más abajo, el límite de 15 MB de /api/upload/sign sigue
  // aplicando igual.
  async function addVideo(file: File) {
    if (receivedVideoUrls.length >= 2) return;
    setUploadingVideo(true);
    setErr("");
    const uploaded = await uploadFile(file, "purchase-request-receipts");
    setUploadingVideo(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setReceivedVideoUrls((vs) => [...vs, uploaded.url]);
  }

  function removeVideo(idx: number) {
    setReceivedVideoUrls((vs) => vs.filter((_, i) => i !== idx));
  }

  async function verifyPhotos(requestId: string, photos: string[]) {
    setAiChecking(true);
    setAiResult(null);
    setMinorDifferenceConfirmed(false);
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
        videoUrls: receivedVideoUrls,
        comment: comment.trim() || undefined,
        aiPhotoMatch: aiResult?.likelyMatch ?? null,
        aiPhotoNote: aiResult?.note ?? null,
        minorDifferenceOnly: aiResult?.minorDifferenceOnly ?? null,
        minorDifferenceConfirmed,
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
    setReceivedVideoUrls([]);
    setAiResult(null);
    setMinorDifferenceConfirmed(false);
    setComment("");
    load();
    router.refresh();
  }

  // Confirmado 2026-08-18: pedido explícito del usuario — aprobación final
  // de Daniel sobre una recepción que ya hizo su equipo, recién acá pasa a
  // RECEIVED de verdad.
  async function approveReceipt(id: string) {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/${id}/approve-receipt`, { method: "POST" });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo aprobar.");
      return;
    }
    load();
    router.refresh();
  }

  async function approveUrgentReport(id: string) {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/urgent-reports/${id}/approve`, { method: "POST" });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo aprobar.");
      return;
    }
    setPendingUrgentReports((rs) => rs.filter((r) => r.id !== id));
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

  // Confirmado 2026-08-18: la foto va por LiveCameraCapture (handler abajo);
  // esta función queda exclusiva para el video opcional, capturado con el
  // input nativo `capture="environment"` — video no se comprime (no es
  // viable en el navegador sin una librería pesada), el límite de 15 MB de
  // /api/upload/sign sigue aplicando igual.
  async function addUrgentVideo(file: File) {
    if (urgentMediaUrls.length >= 4) return;
    setUploadingUrgentMedia(true);
    setErr("");
    const uploaded = await uploadFile(file, "purchase-request-receipts");
    setUploadingUrgentMedia(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setUrgentMediaUrls((m) => [...m, uploaded.url]);
  }

  function handleUrgentPhotoCaptured(url: string) {
    setUrgentMediaUrls((m) => [...m, url]);
    setTakingUrgentPhoto(false);
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

  function handleReplacementPhotoCaptured(url: string) {
    setReplacementPhotoUrls((p) => [...p, url]);
    setTakingReplacementPhoto(false);
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

  // Confirmado 2026-08-18: pedido explícito del usuario — aprobación final
  // de Daniel sobre un cambio de mercadería que ya subió su equipo.
  async function approveReplacement(resolutionId: string) {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/urgent-resolutions/${resolutionId}/approve-replacement`, { method: "POST" });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo aprobar.");
      return;
    }
    load();
    router.refresh();
  }

  if (!rows) return <div className="text-steel text-[13px]">Cargando…</div>;

  const groups = groupRows(rows);

  return (
    <div className="flex flex-col gap-2.5">
      {canApprove && pendingUrgentReports.length > 0 && (
        <div className="bg-surface border border-red/40 rounded-md p-4 mb-1">
          <div className="flex items-center gap-1.5 text-[12px] font-bold mb-2 text-red">
            <AlertTriangle size={14} /> Reportes urgentes pendientes de tu revisión
          </div>
          <div className="flex flex-col gap-2.5">
            {pendingUrgentReports.map((pr) => {
              const total = pr.damagedQty + pr.incompleteQty + pr.differentQty + pr.missingQty;
              return (
                <div key={pr.id} className="bg-cloud rounded-md p-3">
                  <div className="text-[13px] font-bold">{pr.request.catalogItem.name}</div>
                  <div className="text-[11.5px] text-steel mb-2">
                    {pr.request.supplier.name} — {total} un. afectadas · reportado por {actorName(pr.reportedBy?.name)} · {new Date(pr.reportedAt).toLocaleDateString("es-MX")}
                  </div>
                  <div className="text-[11.5px] text-ink mb-2">&quot;{pr.description}&quot;</div>
                  <div className="grid grid-cols-4 gap-2 mb-2.5">
                    {pr.mediaUrls.map((url, i) =>
                      isVideoUrl(url) ? (
                        <video key={i} src={url} controls className="w-full h-32 rounded object-contain border border-rule bg-navy" />
                      ) : (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="bg-navy rounded border border-rule flex items-center justify-center h-32">
                          <img src={url} alt="" className="max-w-full max-h-full object-contain" />
                        </a>
                      )
                    )}
                  </div>
                  {err && <div className="text-red text-[12px] mb-2">{err}</div>}
                  <button type="button" disabled={busy} className="rounded border border-red bg-red px-3.5 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => approveUrgentReport(pr.id)}>
                    ✓ Revisar y enviar a Compras
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
                  {pr.report.request.supplier.name}
                  {(canApprove || isAdmin) && ` — ${pr.quantity} un.`}
                  {" "}· llega hasta {pr.replacementDueDate ? new Date(pr.replacementDueDate).toLocaleDateString("es-MX") : "—"}
                </div>
                {openReplacementId === pr.id ? (
                  <div>
                    <div className="text-[11px] text-steel mb-1.5">Mínimo 2 fotos, igual que una recepción normal.</div>
                    {replacementPhotoUrls.length > 0 && (
                      <div className="grid grid-cols-3 gap-2 mb-2.5">
                        {replacementPhotoUrls.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="bg-cloud rounded border border-rule flex items-center justify-center h-24">
                            <img src={url} alt="" className="max-w-full max-h-full object-contain" />
                          </a>
                        ))}
                      </div>
                    )}
                    {replacementPhotoUrls.length < 3 && (
                      takingReplacementPhoto ? (
                        <div className="mb-2.5">
                          <LiveCameraCapture folder="purchase-request-receipts" onCaptured={handleReplacementPhotoCaptured} onCancel={() => setTakingReplacementPhoto(false)} />
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="flex items-center gap-1.5 text-[12px] font-semibold border-[1.5px] border-dashed border-rule rounded-md px-3 py-2 cursor-pointer hover:border-teal mb-2.5"
                          onClick={() => setTakingReplacementPhoto(true)}
                        >
                          <Camera size={14} /> Tomar foto
                        </button>
                      )
                    )}
                    {err && <div className="text-red text-[12px] mb-2">{err}</div>}
                    <div className="flex items-center gap-2">
                      <button type="button" disabled={busy || replacementPhotoUrls.length < 2} className="rounded border border-green bg-green px-3.5 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => confirmReplacement(pr.id)}>
                        ✓ Confirmar que llegó bien
                      </button>
                      <button type="button" className="text-steel text-[12px] cursor-pointer" onClick={() => { setOpenReplacementId(null); setReplacementPhotoUrls([]); }}>Cancelar</button>
                    </div>
                  </div>
                ) : pr.replacementSubmittedAt ? (
                  // Confirmado 2026-08-18: pedido explícito del usuario — el equipo ya
                  // subió las fotos del cambio, falta la aprobación final de Daniel.
                  <div>
                    <div className="text-[11px] text-steel mb-1.5">
                      Subido por {actorName(pr.replacementSubmittedBy?.name)} · {new Date(pr.replacementSubmittedAt).toLocaleDateString("es-MX")}
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-2.5">
                      {pr.replacementPhotoUrls.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="bg-navy rounded border border-rule flex items-center justify-center h-24">
                          <img src={url} alt="" className="max-w-full max-h-full object-contain" />
                        </a>
                      ))}
                    </div>
                    {pr.replacementAiNote && (
                      <div className={`text-[11px] mb-2 ${pr.replacementAiMatch ? "text-teal" : "text-red font-semibold"}`}>🤖 {pr.replacementAiNote}</div>
                    )}
                    {err && <div className="text-red text-[12px] mb-2">{err}</div>}
                    <button
                      type="button"
                      disabled={!canApprove || busy}
                      title={!canApprove ? "Exclusivo del líder de Inventario" : undefined}
                      className="rounded border border-teal bg-teal px-3.5 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={() => approveReplacement(pr.id)}
                    >
                      ✓ Aprobar cambio recibido
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={!canReceiveTeam}
                    title={!canReceiveTeam ? "Exclusivo del equipo de Inventario" : undefined}
                    className="rounded border border-teal bg-teal px-3.5 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={() => { setOpenReplacementId(pr.id); setReplacementPhotoUrls([]); setErr(""); }}
                  >
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
                // Confirmado 2026-08-18: pedido explícito del usuario — Daniel debe ver
                // lado a lado lo que declaró Inventario vs lo que se compró/pagó antes
                // de aprobar. Si hay reportes urgentes, lo esperado es la cantidad buena,
                // no lo pedido originalmente.
                const expectedReceivedQty = r.urgentReports.length > 0 ? goodQuantity(r) : r.quantity;
                const receivedQtyMatches = r.receipt?.receivedQuantity === expectedReceivedQty;
                return (
                <div key={r.id}>
                  <div className="flex items-center justify-between gap-3 flex-wrap mb-0.5">
                    <div className="text-[14px] font-bold">{r.catalogItem.name}</div>
                    {r.status === "RECEIVED" ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-green/15 text-green border border-green/40 rounded-full px-2.5 py-1">
                        <CheckCircle2 size={11} /> Recibido
                      </span>
                    ) : r.status === "RECEIVED_PENDING_REVIEW" ? (
                      <span className="text-[10px] font-bold uppercase tracking-wide bg-teal/15 text-teal border border-teal/40 rounded-full px-2.5 py-1">
                        Pendiente de aprobación
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase tracking-wide bg-gold/15 border border-gold/40 rounded-full px-2.5 py-1" style={{ color: "#D9A441" }}>
                        Pendiente
                      </span>
                    )}
                  </div>
                  {/* Confirmado 2026-08-18: pedido explícito del usuario — unidades y
                      valor pagado son exclusivos de Daniel (líder) y admin; el resto del
                      equipo de Inventario nunca los ve, en ningún lado de esta pantalla. */}
                  {!isMulti && (
                    <div className="text-[11.5px] text-steel mb-1">
                      {r.supplier.name}
                      {(canApprove || isAdmin) && ` — se pidieron y pagaron ${r.quantity} un. · $${r.totalCost.toFixed(2)}`}
                      {r.paidAt && ` · pagado ${new Date(r.paidAt).toLocaleDateString("es-MX")}`}
                    </div>
                  )}
                  {isMulti && (canApprove || isAdmin) && (
                    <div className="text-[11.5px] text-steel mb-1">
                      {r.quantity} un. · ${r.totalCost.toFixed(2)}
                      {r.paidAt && ` · pagado ${new Date(r.paidAt).toLocaleDateString("es-MX")}`}
                    </div>
                  )}
                  {isMulti && !(canApprove || isAdmin) && r.paidAt && (
                    <div className="text-[11.5px] text-steel mb-1">pagado {new Date(r.paidAt).toLocaleDateString("es-MX")}</div>
                  )}

                  {r.status === "PAID" && !missingPurchaseOrder && (
                    <>
                      {openId === r.id ? (
                        <div className="mt-2">
                          <div className="mb-2.5">
                            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
                              {canApprove || isAdmin
                                ? r.urgentReports.length > 0
                                  ? `Cantidad buena a confirmar — ${goodQuantity(r)} un. (de ${r.quantity} pedidas, ya reportadas ${r.quantity - goodQuantity(r)} dañada/incompleta/diferente)`
                                  : `Cantidad recibida — se pidieron ${r.quantity} un.`
                                : "Cantidad recibida — cuenta las unidades que llegaron"}
                            </label>
                            <input type="number" className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]" value={receivedQty} onChange={(e) => setReceivedQty(e.target.value)} />
                            {receivedQty !== "" && Number(receivedQty) !== (r.urgentReports.length > 0 ? goodQuantity(r) : r.quantity) && (
                              <div className="flex items-center gap-1.5 text-[11px] text-red mt-1.5">
                                <AlertTriangle size={12} className="shrink-0" />
                                {canApprove || isAdmin
                                  ? r.urgentReports.length > 0
                                    ? `Debe ser ${goodQuantity(r)} un. — la cantidad buena según lo ya reportado.`
                                    : `No coincide con lo pedido (${r.quantity} un.) — no se puede confirmar así. Usa "🚨 Informar urgente" para reportar la diferencia.`
                                  : `No coincide con lo registrado — vuelve a contar. Si de verdad llegó una cantidad distinta, usa "🚨 Informar urgente" para reportarlo.`}
                              </div>
                            )}
                          </div>
                          {r.urgentReports.length > 0 && (
                            <div className="flex items-start gap-1.5 bg-red/10 border border-red/30 rounded-md px-3 py-2 mb-2.5 text-[11.5px] text-red">
                              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                              Esto confirma solo la parte buena — la operación sigue "pendiente con el proveedor" en Finanzas/Auditoría hasta que se resuelva lo reportado (reemplazo, reembolso/crédito o pérdida).
                            </div>
                          )}

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

                          {receivedPhotoUrls.length > 0 && (
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
                            </div>
                          )}
                          {/* Confirmado 2026-08-18: pedido explícito del usuario — la foto
                              obligatoria solo se toma en vivo dentro de esta pantalla, nunca
                              elegida de galería/portapapeles. */}
                          {receivedPhotoUrls.length < 3 && (
                            takingPhoto ? (
                              <div className="mb-2.5">
                                <LiveCameraCapture folder="purchase-request-receipts" onCaptured={handlePhotoCaptured} onCancel={() => setTakingPhoto(false)} />
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="flex items-center gap-1.5 text-[12.5px] font-semibold border-[1.5px] border-dashed border-rule rounded-md px-3.5 py-2.5 cursor-pointer hover:border-teal mb-2.5"
                                onClick={() => setTakingPhoto(true)}
                              >
                                <Camera size={16} /> Tomar foto
                              </button>
                            )
                          )}

                          {/* Confirmado 2026-08-18: pedido explícito del usuario — video de
                              evidencia ADEMÁS de la foto (que sigue siendo obligatoria arriba),
                              opcional, útil sobre todo cuando llegan muchos bultos a la vez. El
                              atributo `capture` del input nativo solo lo respeta el celular —
                              en laptop caería al explorador de archivos normal, así que esta
                              opción solo se ofrece desde el celular. */}
                          {isMobileDevice && (
                            <>
                              <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
                                Video de evidencia — opcional ({receivedVideoUrls.length}/2)
                              </label>
                              <div className="grid grid-cols-3 gap-2 mb-2.5">
                                {receivedVideoUrls.map((url, i) => (
                                  <div key={i} className="relative">
                                    <video src={url} controls className="w-full h-40 rounded object-contain border border-rule bg-cloud" />
                                    <button
                                      type="button"
                                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red text-white flex items-center justify-center cursor-pointer"
                                      onClick={() => removeVideo(i)}
                                    >
                                      <X size={11} />
                                    </button>
                                  </div>
                                ))}
                                {receivedVideoUrls.length < 2 && (
                                  <label
                                    tabIndex={0}
                                    onClick={(e) => e.preventDefault()}
                                    className="flex flex-col items-center justify-center gap-1 h-40 border-[1.5px] border-dashed border-rule rounded text-[11px] text-steel cursor-pointer hover:border-teal"
                                  >
                                    {uploadingVideo ? <span className="w-4 h-4 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Camera size={16} />}
                                    Grabar video
                                    <input ref={videoCameraInputRef} type="file" accept="video/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && addVideo(e.target.files[0])} />
                                  </label>
                                )}
                              </div>
                            </>
                          )}

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
                          {aiResult && aiResult.likelyMatch === false && aiResult.minorDifferenceOnly && !minorDifferenceConfirmed && (
                            <div className="bg-gold/10 border border-gold/35 rounded-md px-3 py-2.5 mb-2.5">
                              <div className="text-[11px] mb-2" style={{ color: "#D9A441" }}>
                                La IA detectó que sigue siendo el mismo producto de la referencia, con una diferencia menor (ej. color, logo, empaque) — si está bien así, confirma con un clic para no quedarse detenido. Si de verdad llegó otro producto que no se puede dejar pasar, usa &quot;🚨 Informar urgente&quot; en vez de esto.
                              </div>
                              <button
                                type="button"
                                className="rounded border border-gold/50 px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer"
                                style={{ color: "#D9A441" }}
                                onClick={() => setMinorDifferenceConfirmed(true)}
                              >
                                ✓ Es el mismo producto, seguir con el ingreso
                              </button>
                            </div>
                          )}
                          {aiResult && aiResult.likelyMatch === false && aiResult.minorDifferenceOnly && minorDifferenceConfirmed && (
                            <div className="flex items-center gap-1.5 text-[11px] mb-2.5" style={{ color: "#D9A441" }}>
                              <CheckCircle2 size={13} /> Diferencia confirmada — se avisará a todas las partes de ese detalle.
                            </div>
                          )}
                          {aiResult && aiResult.likelyMatch === false && !aiResult.minorDifferenceOnly && (
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
                                aiChecking ||
                                receivedPhotoUrls.length < 2 ||
                                !receivedQty ||
                                Number(receivedQty) !== (r.urgentReports.length > 0 ? goodQuantity(r) : r.quantity) ||
                                (aiResult?.likelyMatch === false && !(aiResult.minorDifferenceOnly && minorDifferenceConfirmed))
                              }
                              title={aiChecking ? "Espera a que la IA termine de comparar las fotos" : undefined}
                              className="rounded border border-green bg-green px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
                              onClick={() => confirmReceipt(r.id)}
                            >
                              {aiChecking ? "Verificando fotos…" : "✓ Confirmar que llegó"}
                            </button>
                            {r.urgentReports.length === 0 && (
                              <button
                                type="button"
                                className="text-[11.5px] font-semibold border border-red/50 text-red rounded px-3 py-1.5 cursor-pointer"
                                onClick={() => { setOpenId(null); setReceivedPhotoUrls([]); setReceivedVideoUrls([]); setAiResult(null); setMinorDifferenceConfirmed(false); openUrgent(r.id); }}
                              >
                                🚨 Informar urgente
                              </button>
                            )}
                            <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={() => { setOpenId(null); setReceivedPhotoUrls([]); setReceivedVideoUrls([]); setAiResult(null); setMinorDifferenceConfirmed(false); }}>Cancelar</button>
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
                              {canApprove || isAdmin
                                ? `${urgentTotal} un. afectadas · $${(urgentTotal * r.unitCost).toFixed(2)} en disputa (costo de la cotización)`
                                : `${urgentTotal} un. afectadas`}
                            </div>
                          )}

                          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
                            Evidencia ({urgentMediaUrls.length}/4) — mínimo 1 foto{isMobileDevice && ", puedes agregar video"}
                          </label>
                          {urgentMediaUrls.length > 0 && (
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
                            </div>
                          )}
                          {/* Confirmado 2026-08-18: pedido explícito del usuario — la foto solo
                              se toma en vivo, nunca elegida de galería/portapapeles; el video
                              (opcional) solo se ofrece desde el celular, mismo criterio que la
                              recepción normal. */}
                          {urgentMediaUrls.length < 4 && (
                            takingUrgentPhoto ? (
                              <div className="mb-2.5">
                                <LiveCameraCapture folder="purchase-request-receipts" onCaptured={handleUrgentPhotoCaptured} onCancel={() => setTakingUrgentPhoto(false)} />
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 mb-2.5">
                                <button
                                  type="button"
                                  className="flex items-center gap-1.5 text-[12px] font-semibold border-[1.5px] border-dashed border-red/40 text-red rounded-md px-3 py-2 cursor-pointer hover:border-red"
                                  onClick={() => setTakingUrgentPhoto(true)}
                                >
                                  <Camera size={14} /> Tomar foto
                                </button>
                                {isMobileDevice && (
                                  <label className="flex items-center gap-1.5 text-[12px] font-semibold border-[1.5px] border-dashed border-red/40 text-red rounded-md px-3 py-2 cursor-pointer hover:border-red">
                                    {uploadingUrgentMedia ? <span className="w-4 h-4 rounded-full border-2 border-rule border-t-red animate-spin" /> : <Camera size={14} />}
                                    Grabar video
                                    <input type="file" accept="video/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && addUrgentVideo(e.target.files[0])} />
                                  </label>
                                )}
                              </div>
                            )
                          )}

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
                              <button
                                type="button"
                                disabled={!canReceiveTeam}
                                title={!canReceiveTeam ? "Exclusivo del equipo de Inventario" : undefined}
                                className="text-[11.5px] font-semibold border border-red/50 text-red rounded px-3 py-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                onClick={() => openUrgent(r.id)}
                              >
                                🚨 Informar urgente
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={!canReceiveTeam}
                              title={!canReceiveTeam ? "Exclusivo del equipo de Inventario" : undefined}
                              className="rounded border border-green bg-green px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              onClick={() => { setOpenId(r.id); setReceivedPhotoUrls([]); setReceivedVideoUrls([]); setAiResult(null); setMinorDifferenceConfirmed(false); setReceivedQty(r.urgentReports.length > 0 ? String(goodQuantity(r)) : ""); setComment(""); setErr(""); }}
                            >
                              {r.urgentReports.length > 0 ? `✓ Confirmar ${goodQuantity(r)} un. buenas` : "✓ Confirmar que llegó"}
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Confirmado 2026-08-18: pedido explícito del usuario — el equipo ya
                      recibió (foto+video), pero todavía no cierra el ciclo: solo lectura
                      para todos, y solo Daniel puede aprobar de verdad. */}
                  {r.status === "RECEIVED_PENDING_REVIEW" && r.receipt && (
                    <div className="mt-1.5">
                      {(canApprove || isAdmin) && (
                        <div className={`flex items-center gap-1.5 text-[11.5px] font-semibold mb-1 ${receivedQtyMatches ? "text-teal" : "text-red"}`}>
                          {receivedQtyMatches ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                          Declarado por Inventario: {r.receipt.receivedQuantity} un. · Comprado y pagado: {r.quantity} un.
                          {r.urgentReports.length > 0 && ` (cantidad buena esperada: ${expectedReceivedQty} un.)`}
                        </div>
                      )}
                      <div className="text-[11.5px] text-steel mb-2">
                        Recibido por {actorName(r.receipt.confirmedBy?.name)} · {new Date(r.receipt.confirmedAt).toLocaleDateString("es-MX")}
                        {r.receipt.comment && ` — "${r.receipt.comment}"`}
                      </div>
                      <div className="grid grid-cols-4 gap-2 mb-2.5">
                        {r.receipt.photoUrls.map((url, i) => (
                          <a key={`p${i}`} href={url} target="_blank" rel="noopener noreferrer" className="bg-cloud rounded border border-rule flex items-center justify-center h-32">
                            <img src={url} alt="" className="max-w-full max-h-full object-contain" />
                          </a>
                        ))}
                        {r.receipt.videoUrls.map((url, i) => (
                          <video key={`v${i}`} src={url} controls className="w-full h-32 rounded object-contain border border-rule bg-cloud" />
                        ))}
                      </div>
                      {err && <div className="text-red text-[12px] mb-2">{err}</div>}
                      <button
                        type="button"
                        disabled={!canApprove || busy}
                        title={!canApprove ? "Exclusivo del líder de Inventario" : undefined}
                        className="rounded border border-teal bg-teal px-3.5 py-1.5 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        onClick={() => approveReceipt(r.id)}
                      >
                        ✓ Aprobar recepción
                      </button>
                    </div>
                  )}

                  {r.status === "RECEIVED" && r.receipt?.approvedBy && (
                    <div className="text-[10px] text-steel-dim mt-1">Aprobado por {actorName(r.receipt.approvedBy.name)}</div>
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

            {(canApprove || isAdmin) && <PurchaseOperationDocuments rows={g.map(toDocRow)} />}
          </div>
        );
      })}
    </div>
  );
}
