"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, X, AlertTriangle, Truck, Package } from "lucide-react";
import { actorName } from "@/lib/actorName";
import { formatDateTime } from "@/lib/formatDateTime";
import { LiveCameraCapture } from "@/components/shared/LiveCameraCapture";
import { LiveVideoCapture } from "@/components/shared/LiveVideoCapture";
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

// Confirmado 2026-08-25: "Reclamo posterior al cierre" — daño descubierto
// DÍAS después de confirmar recibido (ej. al despachar). Reutiliza
// PurchaseRequestUrgentReport (isLateClaim=true) en vez de un modelo aparte.
type ReceivedRow = {
  id: string;
  requestNumber: number | null;
  quantity: number;
  unitCost: number;
  supplierId: string;
  catalogItem: { id: string; name: string; photos: string[] };
  supplier: { id: string; name: string };
  receipt: { confirmedAt: string } | null;
  urgentReports: {
    id: string;
    lateClaimCode: string | null;
    damagedQty: number;
    rejectedAt: string | null;
    reviewedByLeadAt: string | null;
    justConfirmedAt: string | null;
    reportedAt: string;
  }[];
};

type LateClaimCandidate = { id: string; code: string | null; quantity: number; unitCost: number; totalCost: number; receivedAt: string | null };

type LateClaimReview = {
  id: string;
  lateClaimCode: string | null;
  damagedQty: number;
  stockStatus: "IN_STOCK" | "SOLD" | null;
  originUncertain: boolean;
  estimatedUnitCost: number | null;
  description: string;
  mediaUrls: string[];
  reportedAt: string;
  reportedBy: { name: string } | null;
  request: { requestNumber: number | null; unitCost: number; catalogItem: { name: string; photos: string[] }; supplier: { name: string } };
};

type LateClaimJust = {
  id: string;
  lateClaimCode: string | null;
  justWriteOffQty: number | null;
  request: { catalogItem: { name: string }; supplier: { name: string } };
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
  // opcional, útil sobre todo cuando llegan muchos bultos.
  // Confirmado 2026-08-25: el video también se graba en vivo (LiveVideoCapture,
  // MediaRecorder con resolución/bitrate bajos), ya no con el selector nativo
  // de cámara del celular — ese grababa a máxima calidad y no había forma de
  // comprimirlo después en el navegador. getUserMedia solo funciona con
  // cámara trasera real, así que esta opción solo se ofrece si isMobileDevice.
  const [receivedVideoUrls, setReceivedVideoUrls] = useState<string[]>([]);
  const [takingVideo, setTakingVideo] = useState(false);
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  useEffect(() => {
    setIsMobileDevice(/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));
  }, []);

  // Cola de Daniel: "Informar urgente" que el equipo subió y todavía no revisó.
  const [pendingUrgentReports, setPendingUrgentReports] = useState<PendingUrgentReport[]>([]);
  // Confirmado 2026-08-27: pedido explícito del usuario — Daniel es quien
  // ajusta la cantidad faltante antes de aprobar (él sí ve pr.request.quantity),
  // el equipo que reporta nunca la escribe. Un input editable por reporte.
  const [missingQtyEdits, setMissingQtyEdits] = useState<Record<string, string>>({});
  // Confirmado 2026-08-27: pedido explícito del usuario — un solo clic no
  // alcanza para mandar la cantidad faltante a Compras (riesgo de click por
  // error); primero tiene que confirmar ese número específico en una segunda
  // pantalla, mismo patrón que "Dar de baja en Just" (justDoubleConfirm).
  const [confirmingMissingId, setConfirmingMissingId] = useState<string | null>(null);

  // Informar urgente — cantidad contada + desglose por tipo + evidencia.
  const [urgentCountedQty, setUrgentCountedQty] = useState("");
  const [urgentDamagedQty, setUrgentDamagedQty] = useState("");
  const [urgentDifferentQty, setUrgentDifferentQty] = useState("");
  const [urgentIncompleteQty, setUrgentIncompleteQty] = useState("");
  const [urgentDesc, setUrgentDesc] = useState("");
  const [urgentMediaUrls, setUrgentMediaUrls] = useState<string[]>([]);
  const [takingUrgentPhoto, setTakingUrgentPhoto] = useState(false);
  const [takingUrgentVideo, setTakingUrgentVideo] = useState(false);

  const [pendingReplacements, setPendingReplacements] = useState<PendingReplacement[]>([]);
  const [openReplacementId, setOpenReplacementId] = useState<string | null>(null);
  const [replacementPhotoUrls, setReplacementPhotoUrls] = useState<string[]>([]);
  const [takingReplacementPhoto, setTakingReplacementPhoto] = useState(false);

  // ---------------- Reclamo posterior al cierre ----------------
  const [receivedRows, setReceivedRows] = useState<ReceivedRow[]>([]);
  const [lateClaimsReview, setLateClaimsReview] = useState<LateClaimReview[]>([]);
  const [lateClaimsJust, setLateClaimsJust] = useState<LateClaimJust[]>([]);

  const [lateOpenId, setLateOpenId] = useState<string | null>(null); // ReceivedRow.id con el formulario abierto
  const [lateCandidates, setLateCandidates] = useState<LateClaimCandidate[]>([]);
  const [lateAverageCost, setLateAverageCost] = useState<number | null>(null);
  const [lateLoadingCandidates, setLateLoadingCandidates] = useState(false);
  const [lateOriginId, setLateOriginId] = useState<string | null>(null);
  const [lateOriginUncertain, setLateOriginUncertain] = useState(false);
  const [lateDamagedQty, setLateDamagedQty] = useState("");
  const [lateStockStatus, setLateStockStatus] = useState<"IN_STOCK" | "SOLD">("IN_STOCK");
  const [lateWhy, setLateWhy] = useState("");
  const [lateMediaUrls, setLateMediaUrls] = useState<string[]>([]);
  const [lateTakingPhoto, setLateTakingPhoto] = useState(false);

  const [lateRejectId, setLateRejectId] = useState<string | null>(null);
  const [lateRejectReason, setLateRejectReason] = useState("");

  const [justOpenId, setJustOpenId] = useState<string | null>(null);
  const [justQtyInput, setJustQtyInput] = useState("");
  const [justAffirmed, setJustAffirmed] = useState(false);
  const [justDoubleConfirm, setJustDoubleConfirm] = useState(false);

  function load() {
    fetch("/api/purchase-requests?view=receiving").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
    fetch("/api/purchase-requests/urgent-resolutions/pending-replacements").then((r) => (r.ok ? r.json() : [])).then(setPendingReplacements).catch(() => setPendingReplacements([]));
    if (canApprove || canReceiveTeam || isAdmin) {
      fetch("/api/purchase-requests?view=received").then((r) => (r.ok ? r.json() : [])).then(setReceivedRows).catch(() => setReceivedRows([]));
    }
    if (canApprove || isAdmin) {
      fetch("/api/purchase-requests/urgent-reports/pending-review").then((r) => (r.ok ? r.json() : [])).then(setPendingUrgentReports).catch(() => setPendingUrgentReports([]));
      fetch("/api/purchase-requests/late-claims/pending-review").then((r) => (r.ok ? r.json() : [])).then(setLateClaimsReview).catch(() => setLateClaimsReview([]));
      fetch("/api/purchase-requests/late-claims/pending-just").then((r) => (r.ok ? r.json() : [])).then(setLateClaimsJust).catch(() => setLateClaimsJust([]));
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [canApprove, canReceiveTeam, isAdmin]);

  async function openLateClaim(row: ReceivedRow) {
    setLateOpenId(row.id);
    setLateCandidates([]);
    setLateAverageCost(null);
    setLateOriginId(row.id);
    setLateOriginUncertain(false);
    setLateDamagedQty("");
    setLateStockStatus("IN_STOCK");
    setLateWhy("");
    setLateMediaUrls([]);
    setErr("");
    setLateLoadingCandidates(true);
    const res = await fetch(`/api/purchase-requests/late-claim-candidates?catalogItemId=${row.catalogItem.id}&supplierId=${row.supplierId}`);
    setLateLoadingCandidates(false);
    const data = await res.json().catch(() => null);
    if (res.ok && data) {
      setLateCandidates(data.candidates);
      setLateAverageCost(data.averageUnitCost);
    }
  }

  function handleLatePhotoCaptured(url: string) {
    setLateMediaUrls((m) => [...m, url]);
    setLateTakingPhoto(false);
  }

  function removeLateMedia(idx: number) {
    setLateMediaUrls((m) => m.filter((_, i) => i !== idx));
  }

  async function submitLateClaim() {
    const damaged = Number(lateDamagedQty) || 0;
    if (damaged <= 0) { setErr("Ingresa la cantidad dañada."); return; }
    if (!lateOriginId) { setErr("Elige a qué solicitud pertenece, o marca que no estás seguro."); return; }
    if (!lateWhy.trim()) { setErr("Explica por qué no se detectó al recibir."); return; }
    if (lateMediaUrls.length === 0) { setErr("Sube al menos una foto de evidencia."); return; }
    if (lateOriginUncertain && lateAverageCost == null) { setErr("No hay costo promedio disponible para este producto/proveedor."); return; }
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/${lateOriginId}/late-claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        damagedQty: damaged,
        stockStatus: lateStockStatus,
        whyNotDetected: lateWhy.trim(),
        mediaUrls: lateMediaUrls,
        originUncertain: lateOriginUncertain,
        estimatedUnitCost: lateOriginUncertain ? lateAverageCost : undefined,
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo enviar el reclamo."); return; }
    setLateOpenId(null);
    load();
  }

  async function reviewLateClaim(id: string, action: "approve" | "reject") {
    setBusy(true);
    setErr("");
    const body: Record<string, unknown> = action === "approve" ? { action } : { action, reason: lateRejectReason.trim() };
    const res = await fetch(`/api/purchase-requests/late-claims/${id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo procesar."); return; }
    setLateRejectId(null);
    setLateRejectReason("");
    load();
  }

  function openJustConfirm(claim: LateClaimJust) {
    setJustOpenId(claim.id);
    setJustQtyInput("");
    setJustAffirmed(false);
    setJustDoubleConfirm(false);
    setErr("");
  }

  async function submitJustConfirm(id: string) {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/late-claims/${id}/just-confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmedQty: Number(justQtyInput) }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo confirmar."); return; }
    setJustOpenId(null);
    load();
  }

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

  // Confirmado 2026-08-25: LiveVideoCapture ya sube el archivo (graba
  // comprimido con MediaRecorder + uploadFile internamente) y entrega la URL
  // final — acá solo se agrega al arreglo, mismo criterio que las fotos.
  function handleVideoCaptured(url: string) {
    setReceivedVideoUrls((vs) => [...vs, url]);
    setTakingVideo(false);
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

  async function approveUrgentReport(id: string, missingQty: number) {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/urgent-reports/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missingQty }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo aprobar.");
      return;
    }
    setPendingUrgentReports((rs) => rs.filter((r) => r.id !== id));
    setMissingQtyEdits((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
    setConfirmingMissingId(null);
  }

  function openUrgent(id: string) {
    setUrgentId(id);
    // Confirmado 2026-08-27: si ya había contado antes de tocar "Informar
    // urgente" (viene del aviso de que no coincide), se mantiene lo que ya
    // tecleó en vez de hacerlo contar de nuevo desde cero.
    setUrgentCountedQty(receivedQty);
    setUrgentDamagedQty("");
    setUrgentDifferentQty("");
    setUrgentIncompleteQty("");
    setUrgentDesc("");
    setUrgentMediaUrls([]);
    setErr("");
  }

  // Confirmado 2026-08-25: la foto va por LiveCameraCapture y el video
  // opcional por LiveVideoCapture (ambos suben el archivo internamente) —
  // acá solo se agrega la URL final al arreglo.
  function handleUrgentVideoCaptured(url: string) {
    setUrgentMediaUrls((m) => [...m, url]);
    setTakingUrgentVideo(false);
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
    // Confirmado 2026-08-27: pedido explícito del usuario — ya no hace falta
    // que dañada/incompleta/diferente sumen algo para poder enviar; basta con
    // que lo contado no coincida con lo comprado. Acá no se conoce el total
    // pedido para validarlo antes de mandar, así que la comprobación final
    // (¿de verdad hay algo que reportar?) queda del lado del servidor, que
    // sí lo conoce (ver [id]/urgent-report/route.ts).
    if (urgentCountedQty === "") {
      setErr("Ingresa la cantidad que contaste.");
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
      body: JSON.stringify({
        damagedQty: damaged,
        differentQty: different,
        incompleteQty: incomplete,
        countedQty: Number(urgentCountedQty),
        description: urgentDesc.trim(),
        mediaUrls: urgentMediaUrls,
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo enviar el reporte.");
      return;
    }
    setUrgentId(null);
    setUrgentCountedQty("");
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
      {(canApprove || isAdmin) && pendingUrgentReports.length > 0 && (
        <div className="bg-surface border border-red/40 rounded-md p-4 mb-1">
          <div className="flex items-center gap-1.5 text-[12px] font-bold mb-2 text-red">
            <AlertTriangle size={14} /> Reportes urgentes pendientes de tu revisión
          </div>
          <div className="flex flex-col gap-2.5">
            {pendingUrgentReports.map((pr) => {
              // Confirmado 2026-08-27: pedido explícito del usuario — Bryan/Joel
              // solo mandan lo que contaron y lo que vieron dañado/incompleto/
              // diferente de eso; lo faltante lo calculó el servidor al crear el
              // reporte (pr.missingQty) comparando contra lo pedido, pero es
              // Daniel quien lo ve y ajusta acá antes de mandarlo a Compras — él
              // sí ve pr.request.quantity, el equipo nunca lo vio.
              const flaggedQty = pr.damagedQty + pr.incompleteQty + pr.differentQty;
              const countedQty = pr.request.quantity - pr.missingQty;
              const missingInput = missingQtyEdits[pr.id] ?? String(pr.missingQty);
              const missingNum = Number(missingInput) || 0;
              const total = flaggedQty + missingNum;
              const overLimit = total > pr.request.quantity;
              const parts = [
                pr.damagedQty > 0 && `${pr.damagedQty} dañada`,
                pr.incompleteQty > 0 && `${pr.incompleteQty} incompleta`,
                pr.differentQty > 0 && `${pr.differentQty} diferente`,
              ].filter(Boolean) as string[];
              return (
                <div key={pr.id} className="bg-cloud rounded-md p-3">
                  <div className="text-[13px] font-bold">{pr.request.catalogItem.name}</div>
                  <div className="text-[11.5px] text-steel mb-2">
                    {pr.request.supplier.name} — se pidieron {pr.request.quantity} un., contó {countedQty} · reportado por {actorName(pr.reportedBy?.name)} · {formatDateTime(pr.reportedAt)}
                  </div>
                  {parts.length > 0 && <div className="text-[11.5px] text-steel mb-2">{parts.join(" · ")}</div>}
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
                  <div className="mb-2.5">
                    <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-red">Cantidad faltante</label>
                    <input
                      type="number"
                      min={0}
                      disabled={!canApprove || confirmingMissingId === pr.id}
                      className="w-full rounded border border-red px-2.5 py-2 text-[13px] font-bold text-red"
                      style={{ maxWidth: 160 }}
                      value={missingInput}
                      onChange={(e) => setMissingQtyEdits((m) => ({ ...m, [pr.id]: e.target.value }))}
                    />
                    {overLimit && (
                      <div className="flex items-center gap-1.5 text-[11px] text-red mt-1.5">
                        <AlertTriangle size={12} className="shrink-0" /> El total no puede superar lo pedido ({pr.request.quantity} un.).
                      </div>
                    )}
                  </div>
                  {total > 0 && (
                    <div className="text-[12px] font-semibold text-ink mb-2.5">
                      {total} un. afectadas · ${(total * pr.request.unitCost).toFixed(2)} en disputa
                    </div>
                  )}
                  {err && <div className="text-red text-[12px] mb-2">{err}</div>}
                  {/* Confirmado 2026-08-27: pedido explícito del usuario — la cantidad
                      faltante se confirma en un segundo paso aparte, para que un clic de
                      más no mande a Compras un número que Daniel no revisó a propósito. */}
                  {confirmingMissingId === pr.id ? (
                    <div className="bg-navy rounded-md p-3">
                      <div className="text-[13px] font-bold mb-1.5">¿Seguro?</div>
                      <div className="text-[12px] text-steel mb-3">
                        Vas a confirmar {missingNum} un. faltantes y mandar este reporte a Compras.
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded border border-red bg-red px-3.5 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60"
                          onClick={() => approveUrgentReport(pr.id, missingNum)}
                        >
                          Sí, enviar a Compras
                        </button>
                        <button type="button" className="text-steel text-[12px] cursor-pointer" onClick={() => setConfirmingMissingId(null)}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={!canApprove || busy || overLimit}
                      title={!canApprove ? "Exclusivo del líder de Inventario" : undefined}
                      className="rounded border border-red bg-red px-3.5 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={() => setConfirmingMissingId(pr.id)}
                    >
                      ✓ Revisar y enviar a Compras
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(canApprove || isAdmin) && lateClaimsReview.length > 0 && (
        <div className="bg-surface border border-teal/40 rounded-md p-4 mb-1">
          <div className="flex items-center gap-1.5 text-[12px] font-bold mb-2 text-teal">
            <Package size={14} /> Reclamos posteriores al cierre pendientes de tu revisión
          </div>
          <div className="flex flex-col gap-2.5">
            {lateClaimsReview.map((c) => (
              <div key={c.id} className="bg-cloud rounded-md p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                  <div className="text-[13px] font-bold">{c.request.catalogItem.name}</div>
                  <span className="text-[10px] font-mono font-bold text-teal bg-teal/10 border border-teal/40 rounded px-1.5 py-0.5">{c.lateClaimCode}</span>
                </div>
                <div className="text-[11.5px] text-steel mb-2">
                  {c.request.supplier.name} — {c.damagedQty} un. dañadas · reportado por {actorName(c.reportedBy?.name)} · {formatDateTime(c.reportedAt)}
                  {c.stockStatus === "SOLD" && " · ya se vendieron"}
                </div>
                {c.originUncertain && (
                  <div className="flex items-center gap-1.5 text-[11px] text-gold mb-2" style={{ color: "#D9A441" }}>
                    <AlertTriangle size={12} /> Origen incierto — costo promedio ${c.estimatedUnitCost?.toFixed(2)}/un. en vez del de {c.request.requestNumber ? `SC-${String(c.request.requestNumber).padStart(3, "0")}` : "la solicitud"}.
                  </div>
                )}
                <div className="bg-navy rounded px-3 py-2 mb-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1">¿Por qué no se detectó al recibir?</div>
                  <div className="text-[11.5px] text-ink italic">&quot;{c.description}&quot;</div>
                </div>
                <div className="grid grid-cols-4 gap-2 mb-2.5">
                  {c.mediaUrls.map((url, i) =>
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
                {lateRejectId === c.id ? (
                  <div>
                    <textarea className="w-full rounded border border-rule px-2.5 py-2 text-[12.5px] mb-2" rows={2} placeholder="Explica por qué no procede..." value={lateRejectReason} onChange={(e) => setLateRejectReason(e.target.value)} />
                    <div className="flex items-center gap-2">
                      <button type="button" disabled={busy || !lateRejectReason.trim()} className="rounded border border-red bg-red px-3.5 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => reviewLateClaim(c.id, "reject")}>
                        Confirmar rechazo
                      </button>
                      <button type="button" className="text-steel text-[12px] cursor-pointer" onClick={() => { setLateRejectId(null); setLateRejectReason(""); }}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!canApprove || busy}
                      title={!canApprove ? "Exclusivo del líder de Inventario" : undefined}
                      className="rounded border border-green bg-green px-3.5 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={() => reviewLateClaim(c.id, "approve")}
                    >
                      ✓ Aprobar
                    </button>
                    <button
                      type="button"
                      disabled={!canApprove || busy}
                      title={!canApprove ? "Exclusivo del líder de Inventario" : undefined}
                      className="text-[11.5px] font-semibold border border-red/50 text-red rounded px-3 py-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={() => { setLateRejectId(c.id); setLateRejectReason(""); }}
                    >
                      ✗ Rechazar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(canApprove || isAdmin) && lateClaimsJust.length > 0 && (
        <div className="bg-surface border border-gold/40 rounded-md p-4 mb-1">
          <div className="flex items-center gap-1.5 text-[12px] font-bold mb-2" style={{ color: "#D9A441" }}>
            <Package size={14} /> Dar de baja en Just
          </div>
          <div className="flex flex-col gap-2.5">
            {lateClaimsJust.map((c) => (
              <div key={c.id} className="bg-cloud rounded-md p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                  <div className="text-[13px] font-bold">{c.request.catalogItem.name}</div>
                  <span className="text-[10px] font-mono font-bold" style={{ color: "#D9A441" }}>{c.lateClaimCode}</span>
                </div>
                {justOpenId === c.id ? (
                  <div>
                    {!justDoubleConfirm ? (
                      <>
                        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
                          Confirma cuántas unidades diste de baja en Just
                        </label>
                        <input type="number" className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px] mb-2.5" style={{ maxWidth: 160 }} value={justQtyInput} onChange={(e) => setJustQtyInput(e.target.value)} />
                        <label className="flex items-start gap-2 text-[12px] text-steel mb-2.5 cursor-pointer">
                          <input type="checkbox" className="mt-0.5" checked={justAffirmed} onChange={(e) => setJustAffirmed(e.target.checked)} />
                          Confirmo que entré a Just y descarté físicamente estas unidades del inventario disponible
                        </label>
                        {justQtyInput !== "" && Number(justQtyInput) !== c.justWriteOffQty && (
                          <div className="flex items-center gap-1.5 text-[11px] text-red mb-2.5">
                            <AlertTriangle size={12} /> Debe ser {c.justWriteOffQty} un. — la cantidad aprobada en el reclamo.
                          </div>
                        )}
                        <button
                          type="button"
                          disabled={Number(justQtyInput) !== c.justWriteOffQty || !justAffirmed}
                          className="rounded border border-green bg-green px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          onClick={() => setJustDoubleConfirm(true)}
                        >
                          Confirmar baja en Just
                        </button>
                      </>
                    ) : (
                      <div className="bg-navy rounded-md p-3">
                        <div className="text-[13px] font-bold mb-1.5">¿Seguro?</div>
                        <div className="text-[12px] text-steel mb-3">Vas a marcar {c.lateClaimCode} como dado de baja en Just — esta acción no se puede deshacer.</div>
                        {err && <div className="text-red text-[12px] mb-2">{err}</div>}
                        <div className="flex items-center gap-2">
                          <button type="button" disabled={busy} className="rounded border border-green bg-green px-3.5 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => submitJustConfirm(c.id)}>
                            Sí, confirmar
                          </button>
                          <button type="button" className="text-steel text-[12px] cursor-pointer" onClick={() => setJustDoubleConfirm(false)}>Cancelar</button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={!canApprove}
                    title={!canApprove ? "Exclusivo del líder de Inventario" : undefined}
                    className="rounded border border-gold/50 px-3.5 py-1.5 text-[12px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ color: "#D9A441" }}
                    onClick={() => openJustConfirm(c)}
                  >
                    Dar de baja en Just
                  </button>
                )}
              </div>
            ))}
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
                      Subido por {actorName(pr.replacementSubmittedBy?.name)} · {formatDateTime(pr.replacementSubmittedAt)}
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
                      {r.paidAt && ` · pagado ${formatDateTime(r.paidAt)}`}
                    </div>
                  )}
                  {isMulti && (canApprove || isAdmin) && (
                    <div className="text-[11.5px] text-steel mb-1">
                      {r.quantity} un. · ${r.totalCost.toFixed(2)}
                      {r.paidAt && ` · pagado ${formatDateTime(r.paidAt)}`}
                    </div>
                  )}
                  {isMulti && !(canApprove || isAdmin) && r.paidAt && (
                    <div className="text-[11.5px] text-steel mb-1">pagado {formatDateTime(r.paidAt)}</div>
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
                              {receivedVideoUrls.length > 0 && (
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
                                </div>
                              )}
                              {receivedVideoUrls.length < 2 && (
                                takingVideo ? (
                                  <div className="mb-2.5">
                                    <LiveVideoCapture folder="purchase-request-receipts" onCaptured={handleVideoCaptured} onCancel={() => setTakingVideo(false)} />
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    className="flex items-center gap-1.5 text-[12.5px] font-semibold border-[1.5px] border-dashed border-rule rounded-md px-3.5 py-2.5 cursor-pointer hover:border-teal mb-2.5"
                                    onClick={() => setTakingVideo(true)}
                                  >
                                    <Camera size={16} /> Grabar video
                                  </button>
                                )
                              )}
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

                          {/* Confirmado 2026-08-27: pedido explícito del usuario — quien cuenta
                              no sabe cuánto se pidió comprar, así que nunca calcula cuántas
                              faltan; solo dice lo que sí puede saber por su cuenta (cuánto contó
                              en total, y de eso cuánto está dañado/incompleto/diferente). Lo
                              faltante lo calcula el sistema y lo confirma Daniel al revisar. */}
                          <div className="mb-2.5">
                            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Cantidad que contaste</label>
                            <input type="number" min={0} className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]" style={{ maxWidth: 160 }} value={urgentCountedQty} onChange={(e) => setUrgentCountedQty(e.target.value)} />
                          </div>

                          <div className="text-[10px] text-steel-dim mb-1">De lo que contaste, ¿cuánto está dañado, incompleto o es un producto distinto?</div>
                          <div className="grid grid-cols-3 gap-2.5 mb-2.5">
                            <div>
                              <label className="block mb-1 text-[10px] text-steel">Dañada</label>
                              <input type="number" min={0} className="w-full rounded border border-rule px-2 py-2 text-[13px]" value={urgentDamagedQty} onChange={(e) => setUrgentDamagedQty(e.target.value)} />
                            </div>
                            <div>
                              <label className="block mb-1 text-[10px] text-steel">Producto incompleto (falta algo adentro)</label>
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
                            ) : takingUrgentVideo ? (
                              <div className="mb-2.5">
                                <LiveVideoCapture folder="purchase-request-receipts" onCaptured={handleUrgentVideoCaptured} onCancel={() => setTakingUrgentVideo(false)} />
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
                                  <button
                                    type="button"
                                    className="flex items-center gap-1.5 text-[12px] font-semibold border-[1.5px] border-dashed border-red/40 text-red rounded-md px-3 py-2 cursor-pointer hover:border-red"
                                    onClick={() => setTakingUrgentVideo(true)}
                                  >
                                    <Camera size={14} /> Grabar video
                                  </button>
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
                                      Reportado por {actorName(rep.reportedBy?.name)} · {formatDateTime(rep.reportedAt)}
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
                          {r.urgentReports.length > 0 && <span className="text-red"> (faltan {r.quantity - expectedReceivedQty} un.)</span>}
                        </div>
                      )}
                      <div className="text-[11.5px] text-steel mb-2">
                        Recibido por {actorName(r.receipt.confirmedBy?.name)} · {formatDateTime(r.receipt.confirmedAt)}
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

      {(canReceiveTeam || canApprove || isAdmin) && receivedRows.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">
            Mercadería recibida — reportar daño encontrado después
          </div>
          <div className="flex flex-col gap-2.5">
            {receivedRows.map((row) => {
              const openClaim = row.urgentReports.find((c) => !c.rejectedAt);
              return (
                <div key={row.id} className="bg-surface border border-rule rounded-md p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap mb-0.5">
                    <div className="text-[14px] font-bold">{row.catalogItem.name}</div>
                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-green/15 text-green border border-green/40 rounded-full px-2.5 py-1">
                      <CheckCircle2 size={11} /> Recibido
                    </span>
                  </div>
                  <div className="text-[11.5px] text-steel mb-2">
                    {row.supplier.name}
                    {row.receipt?.confirmedAt && ` — recibido ${formatDateTime(row.receipt.confirmedAt)}`}
                  </div>

                  {openClaim ? (
                    <div className="bg-teal/10 border border-teal/30 rounded-md px-3 py-2 text-[11.5px] text-teal">
                      Ya reportado — <span className="font-mono font-bold">{openClaim.lateClaimCode}</span>
                      {" · "}
                      {openClaim.justConfirmedAt ? "en gestión con el proveedor" : openClaim.reviewedByLeadAt ? "aprobado, pendiente de dar de baja en Just" : "pendiente de revisión de Daniel"}
                    </div>
                  ) : lateOpenId === row.id ? (
                    <div className="mt-2">
                      <div className="flex items-center gap-1.5 text-[11px] text-steel mb-3">
                        <Package size={12} /> Sin plazo límite para reportar.
                      </div>

                      <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">¿A qué solicitud de compra pertenece?</label>
                      {lateLoadingCandidates ? (
                        <div className="text-[12px] text-steel mb-2.5">Buscando solicitudes recibidas de este producto…</div>
                      ) : (
                        <div className="flex flex-col gap-1.5 mb-3">
                          {lateCandidates.map((c) => (
                            <label key={c.id} className={`flex items-center gap-2.5 rounded-md px-3 py-2 cursor-pointer border ${!lateOriginUncertain && lateOriginId === c.id ? "border-teal bg-cloud" : "border-rule bg-cloud/60"}`}>
                              <input type="radio" name={`origin-${row.id}`} checked={!lateOriginUncertain && lateOriginId === c.id} onChange={() => { setLateOriginId(c.id); setLateOriginUncertain(false); }} />
                              <span className="text-[12.5px]">
                                <span className="font-mono text-teal font-semibold">{c.code ?? "—"}</span> · {c.quantity} un. recibidas
                                {c.receivedAt && ` ${formatDateTime(c.receivedAt)}`} · ${c.totalCost.toFixed(2)}
                              </span>
                            </label>
                          ))}
                          <label className={`flex items-center gap-2.5 rounded-md px-3 py-2 cursor-pointer border border-dashed ${lateOriginUncertain ? "border-teal bg-cloud" : "border-rule"}`}>
                            <input type="radio" name={`origin-${row.id}`} checked={lateOriginUncertain} onChange={() => setLateOriginUncertain(true)} />
                            <span className="text-[12.5px] text-steel italic">No estoy seguro / mercadería mezclada</span>
                          </label>
                          {lateOriginUncertain && (
                            <div className="text-[11px] text-steel px-1">
                              {lateAverageCost != null ? `Se usará el costo promedio: $${lateAverageCost.toFixed(2)}/un.` : "No hay costo promedio disponible."}
                            </div>
                          )}
                        </div>
                      )}

                      <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Cantidad dañada</label>
                      <input type="number" min={1} className="rounded border border-rule px-2.5 py-2 text-[13.5px] mb-3" style={{ maxWidth: 160 }} value={lateDamagedQty} onChange={(e) => setLateDamagedQty(e.target.value)} />

                      <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">¿Esas unidades siguen en bodega o ya se vendieron?</label>
                      <div className="flex items-center gap-4 mb-3 text-[12.5px]">
                        <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" checked={lateStockStatus === "IN_STOCK"} onChange={() => setLateStockStatus("IN_STOCK")} /> Siguen en bodega</label>
                        <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" checked={lateStockStatus === "SOLD"} onChange={() => setLateStockStatus("SOLD")} /> Ya se vendieron</label>
                      </div>

                      <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">¿Por qué no se detectó al recibir?</label>
                      <textarea className="w-full rounded border border-rule px-2.5 py-2 text-[12.5px] mb-3" rows={2} placeholder="Describe qué pasó..." value={lateWhy} onChange={(e) => setLateWhy(e.target.value)} />

                      <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Evidencia ({lateMediaUrls.length}/4) — mínimo 1 foto</label>
                      {lateMediaUrls.length > 0 && (
                        <div className="grid grid-cols-4 gap-2 mb-2.5">
                          {lateMediaUrls.map((url, i) => (
                            <div key={i} className="relative">
                              {isVideoUrl(url) ? (
                                <video src={url} controls className="w-full h-32 rounded object-contain border border-rule bg-cloud" />
                              ) : (
                                <a href={url} target="_blank" rel="noopener noreferrer" className="bg-cloud rounded border border-rule flex items-center justify-center h-32">
                                  <img src={url} alt="" className="max-w-full max-h-full object-contain" />
                                </a>
                              )}
                              <button type="button" className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red text-white flex items-center justify-center cursor-pointer" onClick={() => removeLateMedia(i)}>
                                <X size={11} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {lateMediaUrls.length < 4 && (
                        lateTakingPhoto ? (
                          <div className="mb-2.5">
                            <LiveCameraCapture folder="purchase-request-receipts" onCaptured={handleLatePhotoCaptured} onCancel={() => setLateTakingPhoto(false)} />
                          </div>
                        ) : (
                          <button type="button" className="flex items-center gap-1.5 text-[12px] font-semibold border-[1.5px] border-dashed border-red/40 text-red rounded-md px-3 py-2 cursor-pointer hover:border-red mb-2.5" onClick={() => setLateTakingPhoto(true)}>
                            <Camera size={14} /> Tomar foto
                          </button>
                        )
                      )}

                      {err && <div className="text-red text-[12px] mb-2">{err}</div>}
                      <div className="flex items-center gap-2">
                        <button type="button" disabled={busy} className="rounded border border-red bg-red px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={submitLateClaim}>
                          Enviar reporte
                        </button>
                        <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={() => setLateOpenId(null)}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={!canReceiveTeam}
                      title={!canReceiveTeam ? "Exclusivo del equipo de Inventario" : undefined}
                      className="flex items-center gap-1.5 rounded border border-red/50 text-red px-3.5 py-1.5 text-[12.5px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={() => openLateClaim(row)}
                    >
                      <Package size={14} /> Reportar daño encontrado después
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
