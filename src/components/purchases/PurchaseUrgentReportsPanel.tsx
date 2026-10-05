"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Wallet, Upload, Package } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { actorName } from "@/lib/actorName";
import { formatDateTime } from "@/lib/formatDateTime";
import { ProofPreview } from "@/components/shared/ProofPreview";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { useFormDraft } from "@/lib/useFormDraft";

type ResolutionType = "CREDIT" | "REPLACEMENT" | "REFUND" | "WRITE_OFF";
type ResolutionStatus = "PENDING" | "COMPLETED" | "CANCELLED";
// UI-only: "MISSING_DELIVERY" no es un tipo aparte en la base — es
// REPLACEMENT con replacementIsMissingDelivery=true. Mismo mecanismo de
// verificación de punta a punta, solo cambia el rótulo (ver
// resolutionLabel más abajo).
type UiResolutionType = ResolutionType | "MISSING_DELIVERY";
type ShortReceipt = { id: string; name: string; supplierName: string; quantity: number; receivedQuantity: number; missing: number; receivedAt: string | null; requestedByName: string | null };
type LeftBehind = { id: string; name: string; supplierName: string; quantity: number; since: string; requestedByName: string | null };

type ResolutionDraftData = { resType: UiResolutionType; resQty: string; resDueDate: string; resNote: string; resProofUrl: string; resProofName: string };
function isResolutionDraftEmpty(d: ResolutionDraftData) {
  return !d.resDueDate.trim() && !d.resNote.trim() && !d.resProofUrl.trim();
}

// Confirmado 2026-09-15: pedido explícito del usuario — desde escritorio
// (laptop/PC) se puede arrastrar y soltar el archivo directo sobre el botón
// de subir comprobante, sin tener que abrir el selector. En celular no
// cambia nada (ahí no existe drag-and-drop, sigue siendo tocar y elegir).
function ProofUploadLabel({ children, uploading, onFile }: { children: ReactNode; uploading?: boolean; onFile: (file: File) => void }) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <label
      className={`flex items-center gap-1.5 border-[1.5px] border-dashed rounded px-2.5 py-1.5 text-[11px] text-steel cursor-pointer hover:border-teal w-fit transition-colors ${dragOver ? "border-teal bg-teal/5" : "border-rule"}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
    >
      {uploading ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={12} />}
      {/* Confirmado 2026-09-15, pedido explícito de Jariel: arrastrar y
          soltar la imagen ya funcionaba acá (onDrop de arriba), pero no
          había ninguna pista visual de que se podía — parecía un botón
          normal de "solo clic". Se aclara en texto para que se note. */}
      {children} <span className="text-steel/70 font-normal">(o arrástrala aquí)</span>
      <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
    </label>
  );
}

type Resolution = {
  id: string;
  type: ResolutionType;
  quantity: number;
  amount: number;
  note: string | null;
  status: ResolutionStatus;
  replacementDueDate: string | null;
  replacementIsMissingDelivery: boolean;
  replacementSubmittedAt: string | null;
  replacementArrivedAt: string | null;
  replacementPhotoUrls: string[];
  replacementAiMatch: boolean | null;
  replacementAiNote: string | null;
  replacementVerifiedBy: { name: string } | null;
  refundProofUrl: string | null;
  refundAiMatch: boolean | null;
  refundAiNote: string | null;
  bankConfirmedAt: string | null;
  credit: { id: string; amount: number; status: "AVAILABLE" | "APPLIED" | "REFUNDED" | "CANCELLED"; proofUrl: string | null; proofName: string | null; proofMismatchNote?: string | null } | null;
  createdBy: { name: string } | null;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelledBy: { name: string } | null;
};

// Espeja la validación real de urgent-resolutions/[id]/cancel/route.ts, para
// no mostrar el botón "Cancelar" cuando el servidor lo va a rechazar de
// todos modos (ya tuvo consecuencias reales: crédito usado, banco
// confirmado, cambio ya verificado o con fotos subidas).
function canCancelResolution(res: Resolution): boolean {
  if (res.status === "CANCELLED") return false;
  if (res.type === "CREDIT") return res.credit?.status === "AVAILABLE";
  if (res.type === "REPLACEMENT") return res.status === "PENDING" && !res.replacementSubmittedAt;
  if (res.type === "REFUND") return res.status === "PENDING";
  return true; // WRITE_OFF: nada externo que deshacer.
}

type Report = {
  id: string;
  damagedQty: number;
  missingQty: number;
  incompleteQty: number;
  differentQty: number;
  description: string;
  mediaUrls: string[];
  reportedAt: string;
  reportedBy: { name: string } | null;
  withinCreditWindow: boolean;
  creditClaimDeadline: string | null;
  resolutions: Resolution[];
  // Confirmado 2026-09-17: excedente (llegó más de lo pedido) — separado de
  // lo dañado/incompleto/diferente/faltante (eso es un reclamo de crédito,
  // esto es lo opuesto). Jariel gestiona con el proveedor, Bryan confirma —
  // ver excess-gestion/excess-confirm.
  excessQty: number;
  excessGestionNote: string | null;
  excessGestionBy: { name: string } | null;
  excessGestionAt: string | null;
  excessConfirmedBy: { name: string } | null;
  excessConfirmedAt: string | null;
  request: { quantity: number; unitCost: number; totalCost: number; catalogItem: { name: string; justCode: string | null }; supplier: { id: string; name: string; paymentMode?: string } };
  // Confirmado 2026-08-25: "Reclamo posterior al cierre" — mismo modelo,
  // isLateClaim distingue este camino del "Informar urgente" normal. Ya
  // solo llega acá una vez que Daniel confirmó la baja en Just.
  isLateClaim: boolean;
  lateClaimCode: string | null;
  originUncertain: boolean;
  estimatedUnitCost: number | null;
  stockStatus: "IN_STOCK" | "SOLD" | null;
  // Confirmado 2026-09-29, pedido de Bryan: Jariel marca que el proveedor no
  // tiene stock (ver supplier-stockout/route.ts).
  supplierStockoutAt: string | null;
  supplierStockoutBy: { name: string } | null;
};

// Confirmado 2026-09-29, pedido del usuario (antifraude): con un proveedor
// a crédito (hoy CHEN), "Pérdida" no se ofrece para lo FALTANTE — haría que
// se le pague mercadería que nunca llegó. Solo cabe para lo dañado,
// incompleto o distinto. Espeja la validación real del servidor
// (urgent-reports/[id]/resolutions).
function writeOffAllowedQty(r: Report): number | null {
  if (r.request.supplier.paymentMode !== "CREDITO") return null;
  const used = r.resolutions.filter((x) => x.type === "WRITE_OFF" && x.status !== "CANCELLED").reduce((s, x) => s + x.quantity, 0);
  return Math.max(0, r.damagedQty + r.incompleteQty + r.differentQty - used);
}

function claimUnitCost(r: Report) {
  return r.isLateClaim && r.originUncertain && r.estimatedUnitCost != null ? r.estimatedUnitCost : r.request.unitCost;
}

function money(n: number) {
  return `$${n.toFixed(2)}`;
}
function isVideoUrl(url: string) {
  return /\.(mp4|mov|webm|avi|m4v)($|\?)/i.test(url);
}
function claimedQty(resolutions: Resolution[]) {
  return resolutions.filter((r) => r.status !== "CANCELLED").reduce((s, r) => s + r.quantity, 0);
}
// Solo lo COMPLETED cuenta para dar el reporte por cerrado — un reembolso o
// cambio de mercadería en curso (PENDING) ya reclamó la cantidad (no se
// puede volver a repartir esa unidad) pero todavía necesita su propio
// seguimiento (subir comprobante, confirmar banco, verificar el cambio), así
// que el reporte se tiene que quedar en la sección abierta/interactiva hasta
// que eso también se complete — mismo criterio que ya usa isReportOpen() en
// src/lib/purchaseUrgent.ts, que esta pantalla no estaba aplicando.
function resolvedQty(resolutions: Resolution[]) {
  return resolutions.filter((r) => r.status === "COMPLETED").reduce((s, r) => s + r.quantity, 0);
}
function totalReported(r: Report) {
  return r.damagedQty + r.missingQty + r.incompleteQty + r.differentQty;
}

const RESOLUTION_LABEL: Record<UiResolutionType, string> = {
  CREDIT: "Crédito futuro",
  REPLACEMENT: "Cambio de mercadería",
  MISSING_DELIVERY: "Entrega de mercadería faltante",
  REFUND: "Reembolso",
  WRITE_OFF: "Pérdida (sin acción)",
};

// El proveedor manda lo que faltó del pedido en vez de dar crédito/reembolso
// — no es un cambio de producto dañado/distinto, así que se rotula distinto
// aunque use el mismo mecanismo de verificación que "Cambio de mercadería".
// Confirmado 2026-09-29, aclaración del usuario: a un proveedor a crédito
// (hoy CHEN) no se le paga por adelantado — "crédito futuro" no tiene
// sentido ahí. Por dentro es el mismo CREDIT, pero se descuenta del MISMO
// pedido al armar la tanda (ver availableCreditsForDebt en supplierDebt.ts):
// en la práctica, esas unidades no se pagan.
const CREDIT_SUPPLIER_CREDIT_LABEL = "No se paga (se descuenta en la tanda)";
function resolutionLabel(res: Resolution, creditSupplier = false): string {
  if (res.type === "REPLACEMENT" && res.replacementIsMissingDelivery) return RESOLUTION_LABEL.MISSING_DELIVERY;
  if (res.type === "CREDIT" && creditSupplier) return CREDIT_SUPPLIER_CREDIT_LABEL;
  return RESOLUTION_LABEL[res.type];
}

// Confirmado 2026-08-06: bandeja donde Bryan (o admin) coordina con el
// proveedor cada "Informar urgente" que sube Daniel — reparte la cantidad
// afectada entre uno o varios caminos (crédito/cambio/reembolso/pérdida),
// nunca escribe un monto a mano (siempre cantidad × costo real de la
// cotización). El reembolso lo confirma admin en su banco; el resto de
// pasos son de Bryan.
// Confirmado 2026-09-01: pedido explícito del usuario — Daniel y su equipo
// de Inventario ahora ven esta misma bandeja pero en solo lectura (canAct
// false): sin el botón "Coordinar resolución", sin subir comprobante de
// reembolso ni confirmar banco. Así tienen a la vista qué sigue sin resolver
// y cómo se resolvió cada reclamo de su equipo, sin poder negociar nada
// ellos mismos — eso se queda exclusivo de quien coordina con el proveedor.
export function PurchaseUrgentReportsPanel({
  isAdmin,
  canAct,
  canManageGestion = false,
  canConfirmExcess = false,
  hideMoney = false,
}: {
  isAdmin: boolean;
  canAct: boolean;
  // Corregido 2026-09-26, pedido del usuario: el equipo de Inventario (no
  // Daniel) ve esta bandeja en solo lectura, pero sin ningún monto.
  hideMoney?: boolean;
  // Confirmado 2026-09-17: pedido explícito del usuario — quien gestiona el
  // excedente con el proveedor (hoy Jariel, canManageOutflowPurchaseGestion)
  // y quien da la confirmación final (hoy Bryan, canActOnPurchaseApproval)
  // son roles distintos entre sí y distintos de canAct (que sigue gateando
  // las resoluciones normales de dañado/incompleto/diferente/faltante).
  canManageGestion?: boolean;
  canConfirmExcess?: boolean;
}) {
  const router = useRouter();
  const [reports, setReports] = useState<Report[] | null>(null);
  const [excessGestionId, setExcessGestionId] = useState<string | null>(null);
  const [excessGestionNoteInput, setExcessGestionNoteInput] = useState("");
  // Confirmado 2026-09-18: pedido explícito del usuario — confirmar el
  // excedente es irreversible (habilita que sume al Kardex), así que un solo
  // clic accidental no basta — requiere un paso intermedio de "¿seguro?".
  const [confirmExcessId, setConfirmExcessId] = useState<string | null>(null);
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const [resType, setResType] = useState<UiResolutionType>("CREDIT");
  const [resQty, setResQty] = useState("");
  const [resDueDate, setResDueDate] = useState("");
  const [resNote, setResNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Confirmado 2026-08-25: pedido explícito del usuario — el comprobante que
  // manda el proveedor cuando acepta dar crédito queda adjunto desde que se
  // registra, para trazabilidad de punta a punta.
  const [resProofUrl, setResProofUrl] = useState("");
  const [resProofName, setResProofName] = useState("");
  const [resProofUploading, setResProofUploading] = useState(false);
  // Confirmado 2026-09-29, pedido del usuario: la IA revisa la captura
  // (¿es del proveedor, del producto, dice que no lo manda / no lo cobra?)
  // para la cantidad escrita. Si no cuadra, hay que explicar — no bloquea.
  const [proofCheck, setProofCheck] = useState<{ read: unknown; signature: string; warnings: string[]; qty: number; url: string } | null>(null);
  const [proofChecking, setProofChecking] = useState(false);
  const [proofNote, setProofNote] = useState("");

  const [refundUploadingFor, setRefundUploadingFor] = useState<string | null>(null);
  const [confirmBankId, setConfirmBankId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [confirmingStockoutId, setConfirmingStockoutId] = useState<string | null>(null);

  // Guardado automático: si sale a revisar otro reclamo antes de terminar
  // de coordinar la resolución, al volver la encuentra tal como la había
  // dejado.
  const { clearDraft: clearResolutionDraft } = useFormDraft<ResolutionDraftData>(
    openReportId ? `purchaseUrgentResolution:${openReportId}` : null,
    { resType, resQty, resDueDate, resNote, resProofUrl, resProofName },
    (d) => {
      setResType(d.resType);
      setResQty(d.resQty);
      setResDueDate(d.resDueDate);
      setResNote(d.resNote);
      setResProofUrl(d.resProofUrl);
      setResProofName(d.resProofName);
    },
    isResolutionDraftEmpty,
    "Resolución de reclamo sin terminar de coordinar",
    "/area/workspace?tab=compras"
  );

  // Pedido del usuario 2026-10-05: faltantes que llegaron cortos y nunca se
  // reclamaron (ver getShortReceiptsUnclaimed).
  const [shortReceipts, setShortReceipts] = useState<ShortReceipt[]>([]);
  const [confirmClaimId, setConfirmClaimId] = useState<string | null>(null);
  // Pedido de Jariel 2026-10-05: lo que no llegó con el resto del pedido (ver
  // getPurchaseLinesLeftBehind) — se abre el reclamo y abajo se elige crédito
  // a favor, devolución del dinero o que el proveedor lo envíe.
  const [leftBehind, setLeftBehind] = useState<LeftBehind[]>([]);

  function load() {
    fetch("/api/purchase-requests/urgent-reports").then((r) => (r.ok ? r.json() : [])).then(setReports).catch(() => setReports([]));
    fetch("/api/purchase-requests/short-receipts").then((r) => (r.ok ? r.json() : [])).then(setShortReceipts).catch(() => setShortReceipts([]));
    fetch("/api/purchase-requests/left-behind").then((r) => (r.ok ? r.json() : [])).then(setLeftBehind).catch(() => setLeftBehind([]));
  }

  async function openShortReceiptClaim(requestId: string, kind: "short-receipt-claim" | "left-behind-claim" = "short-receipt-claim") {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/${requestId}/${kind}`, { method: "POST" });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo abrir el reclamo."); return; }
    setConfirmClaimId(null);
    load();
    router.refresh();
  }
  useEffect(load, []);

  async function submitExcessGestion(reportId: string) {
    if (!excessGestionNoteInput.trim()) { setErr("Explica qué averiguaste con el proveedor."); return; }
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/urgent-reports/${reportId}/excess-gestion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: excessGestionNoteInput.trim() }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo registrar."); return; }
    setExcessGestionId(null);
    setExcessGestionNoteInput("");
    load();
    router.refresh();
  }

  async function markSupplierStockout(reportId: string) {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/urgent-reports/${reportId}/supplier-stockout`, { method: "POST" });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo marcar."); return; }
    setConfirmingStockoutId(null);
    load();
  }

  async function confirmExcess(reportId: string) {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/urgent-reports/${reportId}/excess-confirm`, { method: "POST" });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo confirmar."); return; }
    setConfirmExcessId(null);
    load();
    router.refresh();
  }

  // Confirmado 2026-09-02 (pedido explícito del usuario): la mayoría de las
  // veces el reclamo entero va por un solo camino (crédito, reembolso,
  // etc.) — dividirlo entre varios es la excepción. Antes Bryan tenía que
  // escribir a mano la cantidad aunque el sistema ya sabía cuánto quedaba
  // pendiente, lo que era un paso de más y una forma fácil de equivocarse
  // (ej. escribir 8 en vez de 80). Ahora viene puesta con el total
  // pendiente por defecto — Bryan solo la cambia si de verdad va a dividir
  // el reclamo entre varios caminos.
  function openResolutionForm(reportId: string, remaining: number) {
    setOpenReportId(reportId);
    setResType("CREDIT");
    setResQty(String(remaining));
    setResDueDate("");
    setResNote("");
    setResProofUrl("");
    setResProofName("");
    setProofCheck(null);
    setProofNote("");
    setErr("");
  }

  async function checkCreditProof(reportId: string, url: string, qty: number) {
    if (!url || !qty || qty <= 0) return;
    setProofChecking(true);
    setErr("");
    const res = await fetch("/api/claim-proof/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "no_envio", proofUrl: url, reportId, quantity: qty }),
    });
    setProofChecking(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo revisar la captura."); return; }
    setProofCheck({ read: data.read, signature: data.signature, warnings: data.warnings ?? [], qty, url });
  }

  async function uploadCreditProof(file: File) {
    setResProofUploading(true);
    setErr("");
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-payments");
    setResProofUploading(false);
    if (!uploaded.ok) { setErr(uploaded.error); return; }
    setResProofUrl(uploaded.url);
    setResProofName(file.name);
    setProofCheck(null);
    setProofNote("");
    if (openReportId) await checkCreditProof(openReportId, uploaded.url, Number(resQty));
  }

  async function submitResolution(reportId: string) {
    const qty = Number(resQty);
    if (!qty || qty <= 0) { setErr("Ingresa una cantidad válida."); return; }
    if ((resType === "REPLACEMENT" || resType === "MISSING_DELIVERY") && !resDueDate) { setErr("Elige la fecha máxima de entrega."); return; }
    if (resType === "WRITE_OFF" && !resNote.trim()) { setErr("Explica por qué no se recupera."); return; }
    if (resType === "CREDIT" && !resProofUrl) { setErr("Sube el comprobante del proveedor."); return; }
    const proofReady = proofCheck && proofCheck.url === resProofUrl && proofCheck.qty === qty;
    if (resType === "CREDIT" && !proofReady) { setErr("Falta que la IA revise la captura con esta cantidad."); return; }
    if (resType === "CREDIT" && proofCheck && proofCheck.warnings.length > 0 && !proofNote.trim()) { setErr("La captura no cuadra del todo — explica por qué."); return; }
    setBusy(true);
    setErr("");
    const body: Record<string, unknown> = { type: resType === "MISSING_DELIVERY" ? "REPLACEMENT" : resType, quantity: qty };
    if (resType === "REPLACEMENT" || resType === "MISSING_DELIVERY") { body.dueDate = resDueDate; body.missingDelivery = resType === "MISSING_DELIVERY"; }
    if (resType === "WRITE_OFF") body.note = resNote.trim();
    if (resType === "CREDIT") {
      body.proofUrl = resProofUrl;
      body.proofName = resProofName;
      body.proofRead = proofCheck?.read ?? null;
      body.proofSignature = proofCheck?.signature;
      if (proofNote.trim()) body.proofMismatchNote = proofNote.trim();
    }
    const res = await fetch(`/api/purchase-requests/urgent-reports/${reportId}/resolutions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo registrar."); return; }
    clearResolutionDraft();
    setOpenReportId(null);
    load();
    router.refresh();
  }

  async function uploadRefundProof(resolutionId: string, file: File) {
    setRefundUploadingFor(resolutionId);
    setErr("");
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-payments");
    if (!uploaded.ok) {
      setRefundUploadingFor(null);
      setErr(uploaded.error);
      return;
    }
    const res = await fetch(`/api/purchase-requests/urgent-resolutions/${resolutionId}/refund-proof`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proofUrl: uploaded.url }),
    });
    setRefundUploadingFor(null);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo verificar el comprobante."); return; }
    load();
  }

  async function confirmBank(resolutionId: string) {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/urgent-resolutions/${resolutionId}/confirm-bank`, { method: "POST" });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo confirmar."); return; }
    setConfirmBankId(null);
    load();
    router.refresh();
  }

  async function approveWriteOff(resolutionId: string) {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/urgent-resolutions/${resolutionId}/approve-write-off`, { method: "POST" });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo aprobar."); return; }
    load();
    router.refresh();
  }

  async function cancelResolution(resolutionId: string) {
    if (!cancelReason.trim()) { setErr("Explica por qué se cancela."); return; }
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-requests/urgent-resolutions/${resolutionId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: cancelReason.trim() }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo cancelar."); return; }
    setCancelId(null);
    setCancelReason("");
    load();
    router.refresh();
  }

  if (!reports) return <div className="text-steel text-[13px]">Cargando…</div>;

  const openReports = reports.filter((r) => resolvedQty(r.resolutions) < totalReported(r));
  const closedReports = reports.filter((r) => resolvedQty(r.resolutions) >= totalReported(r));
  const pendingCredits = reports.flatMap((r) => r.resolutions.filter((res) => res.credit?.status === "AVAILABLE").map((res) => ({ report: r, res })));
  // Confirmado 2026-09-17: pendiente de gestión/confirmación del excedente —
  // independiente de openReports/closedReports (esos clasifican por
  // resoluciones de dañado/incompleto/diferente/faltante, que un reporte de
  // solo excedente nunca tiene).
  const pendingExcess = reports.filter((r) => r.excessQty > 0 && !r.excessConfirmedAt);

  return (
    <div className="flex flex-col gap-4">
      {leftBehind.length > 0 && (
        <div className="bg-surface border border-red/40 rounded-md p-4">
          <div className="flex items-center gap-1.5 text-[12px] font-bold mb-2 text-red">
            <AlertTriangle size={14} /> Mercadería que no llegó con el resto del pedido ({leftBehind.length})
          </div>
          <div className="flex flex-col gap-2.5">
            {leftBehind.map((l) => (
              <div key={l.id} className="bg-cloud rounded-md p-3 text-[12px]">
                <div className="font-semibold">{l.name}</div>
                <div className="text-steel text-[11.5px] mb-1.5">
                  {l.supplierName} — no llegaron las <b>{l.quantity} un.</b> · lo demás se recibió {formatDateTime(l.since)} · compra de {actorName(l.requestedByName)}
                </div>
                {canAct ? (
                  confirmClaimId === l.id ? (
                    <div className="bg-surface border border-red/40 rounded-md p-2.5">
                      <div className="text-[11.5px] font-semibold mb-1.5">¿Abrir el reclamo por las {l.quantity} un.? Queda abajo, en los reclamos abiertos, para registrar qué acordaste con el proveedor: crédito a favor, devolución del dinero o que lo envíe.</div>
                      {err && <div className="text-red text-[11.5px] mb-2">{err}</div>}
                      <div className="flex items-center gap-2">
                        <button type="button" disabled={busy} className="rounded border border-red bg-red px-3 py-1.5 text-[11.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => openShortReceiptClaim(l.id, "left-behind-claim")}>Sí, abrir reclamo</button>
                        <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => { setConfirmClaimId(null); setErr(""); }}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="rounded border border-red/50 text-red px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer" onClick={() => { setConfirmClaimId(l.id); setErr(""); }}>
                      Coordinar solución con el proveedor
                    </button>
                  )
                ) : (
                  <div className="text-steel-dim italic text-[11.5px]">Esperando que Compras coordine la solución con el proveedor.</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {shortReceipts.length > 0 && (
        <div className="bg-surface border border-red/40 rounded-md p-4">
          <div className="flex items-center gap-1.5 text-[12px] font-bold mb-2 text-red">
            <AlertTriangle size={14} /> Faltantes que nunca se reclamaron ({shortReceipts.length})
          </div>
          <div className="flex flex-col gap-2.5">
            {shortReceipts.map((s) => (
              <div key={s.id} className="bg-cloud rounded-md p-3 text-[12px]">
                <div className="font-semibold">{s.name}</div>
                <div className="text-steel text-[11.5px] mb-1.5">
                  {s.supplierName} — se pidieron {s.quantity} un., llegaron {s.receivedQuantity}. Faltan <b>{s.missing} un.</b>
                  {s.receivedAt && <> · recibido {formatDateTime(s.receivedAt)}</>} · compra de {actorName(s.requestedByName)}
                </div>
                {canAct ? (
                  confirmClaimId === s.id ? (
                    <div className="bg-surface border border-red/40 rounded-md p-2.5">
                      <div className="text-[11.5px] font-semibold mb-1.5">¿Abrir el reclamo por {s.missing} un. faltantes? Queda abajo, en los reclamos abiertos, para registrar qué responde el proveedor.</div>
                      {err && <div className="text-red text-[11.5px] mb-2">{err}</div>}
                      <div className="flex items-center gap-2">
                        <button type="button" disabled={busy} className="rounded border border-red bg-red px-3 py-1.5 text-[11.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => openShortReceiptClaim(s.id)}>Sí, abrir reclamo</button>
                        <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => { setConfirmClaimId(null); setErr(""); }}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="rounded border border-red/50 text-red px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer" onClick={() => { setConfirmClaimId(s.id); setErr(""); }}>
                      Abrir reclamo al proveedor
                    </button>
                  )
                ) : (
                  <div className="text-steel-dim italic text-[11.5px]">Esperando que Compras abra el reclamo con el proveedor.</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingExcess.length > 0 && (
        <div className="bg-surface border border-teal/40 rounded-md p-4">
          <div className="flex items-center gap-1.5 text-[12px] font-bold mb-2 text-teal">
            <Package size={14} /> Excedente por gestionar ({pendingExcess.length})
          </div>
          <div className="flex flex-col gap-2.5">
            {pendingExcess.map((r) => (
              <div key={r.id} className="bg-cloud rounded-md p-3 text-[12px]">
                <div className="flex items-center gap-1.5 font-semibold">
                  <CatalogCode code={r.request.catalogItem.justCode} />
                  <span>{r.request.catalogItem.name}</span>
                </div>
                <div className="text-steel text-[11.5px] mb-1.5">
                  {r.request.supplier.name} — se pidieron {r.request.quantity} un., llegaron {r.excessQty} de más · reportado por {actorName(r.reportedBy?.name)} · {formatDateTime(r.reportedAt)}
                </div>

                {!r.excessGestionAt ? (
                  canManageGestion ? (
                    excessGestionId === r.id ? (
                      <div className="mt-1.5">
                        <textarea
                          className="w-full rounded border border-rule px-2.5 py-2 text-[12px] mb-2"
                          rows={2}
                          placeholder="¿Qué averiguaste con el proveedor? (factura, guía, respuesta de CHEN...)"
                          value={excessGestionNoteInput}
                          onChange={(e) => setExcessGestionNoteInput(e.target.value)}
                        />
                        {err && <div className="text-red text-[11.5px] mb-2">{err}</div>}
                        <div className="flex items-center gap-2">
                          <button type="button" disabled={busy} className="rounded border border-blue bg-blue px-3 py-1.5 text-[11.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => submitExcessGestion(r.id)}>
                            Guardar gestión
                          </button>
                          <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => { setExcessGestionId(null); setErr(""); }}>Cancelar</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" className="rounded border border-teal/50 text-teal px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer" onClick={() => { setExcessGestionId(r.id); setExcessGestionNoteInput(""); setErr(""); }}>
                        Dejar constancia de la gestión con el proveedor
                      </button>
                    )
                  ) : (
                    <div className="text-steel-dim italic text-[11.5px]">Esperando que Compras gestione esto con el proveedor.</div>
                  )
                ) : (
                  <>
                    <div className="text-steel text-[11.5px] mb-1.5">
                      Gestionado por {actorName(r.excessGestionBy?.name)} · {formatDateTime(r.excessGestionAt)} — &quot;{r.excessGestionNote}&quot;
                    </div>
                    {canConfirmExcess ? (
                      confirmExcessId === r.id ? (
                        <div className="bg-surface border border-green/40 rounded-md p-2.5">
                          <div className="text-[11.5px] font-semibold mb-1.5">¿Confirmas que las {r.excessQty} un. de más son reales y ya se puede sumar al Kardex?</div>
                          <div className="flex items-center gap-2">
                            <button type="button" disabled={busy} className="rounded border border-green bg-green px-3 py-1.5 text-[11.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => confirmExcess(r.id)}>Sí, confirmo</button>
                            <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => setConfirmExcessId(null)}>Cancelar</button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" className="rounded border border-green bg-green px-3 py-1.5 text-[11.5px] font-semibold text-white cursor-pointer" onClick={() => setConfirmExcessId(r.id)}>
                          Confirmar excedente
                        </button>
                      )
                    ) : (
                      <div className="text-steel-dim italic text-[11.5px]">Esperando que Bryan confirme el excedente.</div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingCredits.length > 0 && !hideMoney && (
        <div className="bg-surface border border-gold/40 rounded-md p-4">
          <div className="flex items-center gap-1.5 text-[12px] font-bold mb-2" style={{ color: "var(--color-gold)" }}>
            <Wallet size={14} /> Créditos pendientes de recuperar ({pendingCredits.length})
          </div>
          <div className="flex flex-col gap-1.5">
            {pendingCredits.map(({ report, res }) => {
              const days = Math.floor((Date.now() - new Date(res.createdAt).getTime()) / 86400000);
              const stale = days > 30;
              return (
                <div key={res.id} className="flex items-center justify-between gap-2 bg-cloud rounded px-3 py-2 text-[12px]">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold">{report.request.supplier.name}</span> —
                    <CatalogCode code={report.request.catalogItem.justCode} />
                    <span>{report.request.catalogItem.name}</span>
                  </div>
                  <div className={`font-mono font-semibold ${stale ? "text-red" : "text-steel"}`}>
                    {money(res.credit!.amount)} · {days} días{stale ? " · sin recuperar" : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {reports.length === 0 && <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13.5px]">No hay reportes urgentes todavía.</div>}

      {openReports.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Sin resolver por completo ({openReports.length})</div>
          <div className="flex flex-col gap-2.5">
            {openReports.map((r) => {
              const remaining = totalReported(r) - claimedQty(r.resolutions);
              return (
                <div key={r.id} className={`bg-surface border rounded-md p-4 ${r.isLateClaim ? "border-teal/40" : "border-red/40"}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                    <div className="text-[13.5px] font-bold flex items-center gap-2">
                      <CatalogCode code={r.request.catalogItem.justCode} />
                      {r.request.catalogItem.name}
                      {r.isLateClaim && (
                        <span className="text-[10px] font-bold uppercase tracking-wide bg-teal/15 text-teal border border-teal/40 rounded-full px-2 py-0.5">Reclamo posterior</span>
                      )}
                      {r.lateClaimCode && <span className="text-[10px] font-mono text-steel">{r.lateClaimCode}</span>}
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wide bg-red/15 text-red border border-red/40 rounded-full px-2.5 py-1">
                      {remaining} un. sin resolver
                    </span>
                  </div>
                  <div className="text-[11.5px] text-steel mb-1">
                    {r.request.supplier.name} — {hideMoney ? "" : `pagado ${money(r.request.totalCost)} · `}{r.request.quantity} un. pedidas
                  </div>
                  {r.isLateClaim && r.originUncertain && !hideMoney && (
                    <div className="flex items-center gap-1.5 text-[11px] mb-1" style={{ color: "var(--color-gold)" }}>
                      <AlertTriangle size={11} /> Origen incierto — usando costo promedio ${r.estimatedUnitCost?.toFixed(2)}/un.
                    </div>
                  )}
                  {r.isLateClaim && r.stockStatus === "SOLD" && (
                    <div className="text-[11px] text-steel mb-1">Estas unidades ya se habían vendido al momento del reclamo.</div>
                  )}
                  <div className="text-[11px] text-steel mb-1">
                    {r.damagedQty > 0 && <>Dañada: {r.damagedQty} · </>}
                    {r.incompleteQty > 0 && <>Incompleta: {r.incompleteQty} · </>}
                    {r.differentQty > 0 && <>Diferente: {r.differentQty} · </>}
                    {r.missingQty > 0 && <>Faltante: {r.missingQty} · </>}
                    {hideMoney ? `${totalReported(r)} un. en disputa` : `$${(totalReported(r) * claimUnitCost(r)).toFixed(2)} en disputa`}
                  </div>
                  <div className="text-[12px] mb-2">{r.description}</div>

                  {/* Confirmado 2026-09-29, pedido de Bryan: Daniel solo avisa
                      que no llegó; Jariel, que habla con el proveedor, marca
                      que no tiene stock. Avisa solo a Marketing; el descuento
                      se registra aparte, con captura. */}
                  {r.supplierStockoutAt ? (
                    <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-amber mb-2">
                      🚫 Proveedor sin stock — marcado por {actorName(r.supplierStockoutBy?.name)} · {new Date(r.supplierStockoutAt).toLocaleString("es-MX")} · Marketing ya fue avisado
                    </div>
                  ) : (
                    canAct && !r.isLateClaim && r.missingQty > 0 && remaining > 0 && (
                      confirmingStockoutId === r.id ? (
                        <div className="bg-inset rounded-md p-3 mb-2">
                          <div className="text-[12.5px] font-bold mb-1">¿El proveedor confirmó que no tiene stock?</div>
                          <div className="text-[11.5px] text-steel mb-2.5">
                            Las {r.missingQty} un. quedan marcadas como que nunca van a llegar y se avisa a Marketing para cerrar el ID o bajar el stock. No se descuenta nada: registra abajo {r.request.supplier.paymentMode === "CREDITO" ? `"${CREDIT_SUPPLIER_CREDIT_LABEL}"` : "la devolución o el crédito"} con la captura del proveedor.
                          </div>
                          <div className="flex items-center gap-2">
                            <button type="button" disabled={busy} className="rounded border border-amber bg-amber px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={() => markSupplierStockout(r.id)}>
                              Sí, no tiene stock
                            </button>
                            <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => { setConfirmingStockoutId(null); setErr(""); }}>
                              Cancelar
                            </button>
                          </div>
                          {err && <div className="text-red text-[11.5px] mt-1.5">{err}</div>}
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="rounded border border-amber/60 text-amber px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer mb-2"
                          onClick={() => { setConfirmingStockoutId(r.id); setErr(""); }}
                        >
                          🚫 El proveedor no tiene stock (no va a llegar)
                        </button>
                      )
                    )
                  )}

                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {r.mediaUrls.map((url, i) =>
                      isVideoUrl(url) ? (
                        <video key={i} src={url} controls className="w-20 h-20 rounded object-cover border border-rule bg-cloud" />
                      ) : (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                          <img src={url} alt="" className="w-20 h-20 rounded object-cover border border-rule" />
                        </a>
                      )
                    )}
                  </div>
                  <div className="text-[10px] text-steel-dim mb-2.5">Reportado por {actorName(r.reportedBy?.name)} · {new Date(r.reportedAt).toLocaleString("es-MX")}</div>

                  {!r.withinCreditWindow && (
                    <div className="flex items-center gap-1.5 text-[11px] text-red mb-2.5">
                      <AlertTriangle size={12} /> Ya pasaron 7 días desde el pago — el proveedor puede no aprobar crédito por lo que falte resolver.
                    </div>
                  )}

                  {r.resolutions.length > 0 && (
                    <div className="flex flex-col gap-1.5 mb-2.5">
                      {r.resolutions.map((res) => (
                        <ResolutionRow
                          key={res.id}
                          res={res}
                          creditSupplier={r.request.supplier.paymentMode === "CREDITO"}
                          isAdmin={isAdmin}
                          canAct={canAct}
                          refundUploadingFor={refundUploadingFor}
                          confirmBankId={confirmBankId}
                          setConfirmBankId={setConfirmBankId}
                          onFileRefund={(f) => uploadRefundProof(res.id, f)}
                          onConfirmBank={() => confirmBank(res.id)}
                          busy={busy}
                          cancelId={cancelId}
                          setCancelId={(id) => { setCancelId(id); setCancelReason(""); setErr(""); }}
                          cancelReason={cancelReason}
                          setCancelReason={setCancelReason}
                          onCancel={() => cancelResolution(res.id)}
                          onApproveWriteOff={() => approveWriteOff(res.id)}
                          cancelErr={cancelId === res.id ? err : ""}
                          hideMoney={hideMoney}
                        />
                      ))}
                    </div>
                  )}

                  {!canAct ? (
                    <div className="text-[11.5px] text-steel-dim italic">Esperando que Compras coordine con el proveedor.</div>
                  ) : remaining <= 0 ? (
                    // Confirmado 2026-09-16: la cantidad reclamada ya está
                    // cubierta por una resolución en curso (ej. reembolso
                    // esperando confirmación del banco), pero el reporte
                    // sigue "abierto" hasta que esa resolución se complete
                    // (ver resolvedQty arriba). Antes se seguía mostrando el
                    // formulario para crear OTRA resolución con la cantidad
                    // vieja precargada — el servidor sí la rechazaba (409),
                    // pero Jariel solo veía el error sin entender por qué.
                    <div className="text-[11.5px] text-steel-dim italic">Ya se cubrió todo lo faltante con la resolución de arriba. Esperando a que se complete.</div>
                  ) : openReportId === r.id ? (
                    <div className="bg-cloud rounded-md p-3">
                      <div className="flex gap-1.5 mb-2.5 flex-wrap">
                        {(["CREDIT", "REPLACEMENT", "MISSING_DELIVERY", "REFUND", "WRITE_OFF"] as const).filter((t) => t !== "WRITE_OFF" || writeOffAllowedQty(r) !== 0).map((t) => (
                          <button key={t} type="button" className={`rounded border px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer ${resType === t ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`} onClick={() => setResType(t)}>
                            {t === "CREDIT" && r.request.supplier.paymentMode === "CREDITO" ? CREDIT_SUPPLIER_CREDIT_LABEL : RESOLUTION_LABEL[t]}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                        <div>
                          <label className="block mb-1 text-[10px] text-steel">Cantidad (máx. {remaining})</label>
                          <input type="number" min={1} max={remaining} className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={resQty} onChange={(e) => setResQty(e.target.value)} />
                        </div>
                        {(resType === "REPLACEMENT" || resType === "MISSING_DELIVERY") && (
                          <div>
                            <label className="block mb-1 text-[10px] text-steel">Fecha máxima de {resType === "MISSING_DELIVERY" ? "entrega" : "cambio"}</label>
                            <input type="date" className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={resDueDate} onChange={(e) => setResDueDate(e.target.value)} />
                          </div>
                        )}
                      </div>
                      {resType === "WRITE_OFF" && (
                        <div className="text-[11px] mb-1.5" style={{ color: "var(--color-gold)" }}>
                          ⚠️ Pérdida = se le paga al proveedor aunque no se recupere nada.{isAdmin ? "" : " Queda esperando la aprobación del admin y, mientras tanto, este pedido no se paga."}
                          {writeOffAllowedQty(r) != null && <> Con un proveedor a crédito solo vale para lo dañado, incompleto o distinto (máx. {writeOffAllowedQty(r)} un.) — lo faltante va con &quot;No se paga&quot;.</>}
                        </div>
                      )}
                      {resType === "WRITE_OFF" && (
                        <textarea className="w-full rounded border border-rule px-2.5 py-2 text-[12.5px] mb-2.5" rows={2} placeholder="¿Por qué no se recupera?" value={resNote} onChange={(e) => setResNote(e.target.value)} />
                      )}
                      {resType === "CREDIT" && r.request.supplier.paymentMode === "CREDITO" && (
                        <div className="text-[11px] text-steel mb-1.5">
                          A {r.request.supplier.name} no se le paga por adelantado: estas unidades simplemente no se le pagan — se descuentan de este pedido cuando se arme la tanda. Sube la captura donde el proveedor lo acepta.
                        </div>
                      )}
                      {resType === "CREDIT" && (
                        <div className="mb-2.5">
                          <label className="block mb-1 text-[10px] text-steel">Comprobante del proveedor (chat, correo, nota de crédito)</label>
                          {!resProofUrl ? (
                            <ProofUploadLabel uploading={resProofUploading} onFile={uploadCreditProof}>
                              Subir comprobante
                            </ProofUploadLabel>
                          ) : (
                            <div className="flex items-center gap-2">
                              <ProofPreview url={resProofUrl} size={36} filename={resProofName || "comprobante-credito"} />
                              <label className="text-steel underline cursor-pointer text-[11px]">
                                cambiar
                                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadCreditProof(e.target.files[0])} />
                              </label>
                            </div>
                          )}
                          {resProofUrl && (
                            proofChecking ? (
                              <div className="text-[11.5px] text-steel mt-1.5">🤖 Revisando la captura…</div>
                            ) : !proofCheck || proofCheck.url !== resProofUrl || proofCheck.qty !== Number(resQty) ? (
                              <button type="button" className="text-[11.5px] font-semibold text-teal underline mt-1.5 cursor-pointer" onClick={() => checkCreditProof(r.id, resProofUrl, Number(resQty))}>
                                {proofCheck ? "Cambiaste la cantidad — revisar la captura de nuevo" : "Revisar la captura con IA"}
                              </button>
                            ) : proofCheck.warnings.length === 0 ? (
                              <div className="text-[11.5px] text-green mt-1.5 flex items-center gap-1"><CheckCircle2 size={12} /> 🤖 La captura cuadra con lo que se registra.</div>
                            ) : (
                              <div className="bg-surface border border-red/40 rounded-md p-2.5 mt-2">
                                <div className="text-[11.5px] font-semibold text-red mb-1">🤖 La captura no cuadra del todo:</div>
                                <ul className="list-disc pl-4 text-[11.5px] text-red mb-2">
                                  {proofCheck.warnings.map((w) => <li key={w}>{w}</li>)}
                                </ul>
                                <textarea
                                  className="w-full rounded border border-rule px-2.5 py-2 text-[12px]"
                                  rows={2}
                                  placeholder="Explica por qué igual se registra (el admin lo va a ver)…"
                                  value={proofNote}
                                  onChange={(e) => setProofNote(e.target.value)}
                                />
                              </div>
                            )
                          )}
                        </div>
                      )}
                      {resQty && Number(resQty) > 0 && (
                        <div className="text-[12px] font-semibold mb-2.5">Monto: {money(Number(resQty) * claimUnitCost(r))}</div>
                      )}
                      {Number(resQty) > remaining && (
                        <div className="text-red text-[12px] mb-2">Solo quedan {remaining} un. sin resolver — reduce la cantidad para registrar.</div>
                      )}
                      {err && <div className="text-red text-[12px] mb-2">{err}</div>}
                      <div className="flex items-center gap-2">
                        <button type="button" disabled={busy || resProofUploading || !resQty || Number(resQty) <= 0 || Number(resQty) > remaining} className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => submitResolution(r.id)}>
                          Registrar
                        </button>
                        <button type="button" className="text-steel text-[12px] cursor-pointer" onClick={() => { clearResolutionDraft(); setOpenReportId(null); }}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12px] font-semibold text-white cursor-pointer" onClick={() => openResolutionForm(r.id, remaining)}>
                      Coordinar resolución con el proveedor
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {closedReports.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Resueltos ({closedReports.length})</div>
          <div className="flex flex-col gap-2">
            {closedReports.map((r) => (
              <div key={r.id} className="bg-surface border border-rule rounded-md p-3.5 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold flex items-center gap-1.5">
                    <CatalogCode code={r.request.catalogItem.justCode} />
                    <span>{r.request.catalogItem.name} — {r.request.supplier.name}</span>
                  </div>
                  <CheckCircle2 size={14} className="text-green" />
                </div>
                <div className="flex flex-col gap-1 mt-1.5">
                  {r.resolutions.map((res) => (
                    <div key={res.id} className={res.status === "CANCELLED" ? "text-red line-through" : "text-steel"}>{resolutionLabel(res, r.request.supplier.paymentMode === "CREDITO")} — {res.quantity} un.{hideMoney ? "" : ` · ${money(res.amount)}`}{res.status === "CANCELLED" ? " (anulado)" : ""}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ResolutionRow({
  res, isAdmin, canAct, refundUploadingFor, confirmBankId, setConfirmBankId, onFileRefund, onConfirmBank, busy,
  cancelId, setCancelId, cancelReason, setCancelReason, onCancel, cancelErr, hideMoney, onApproveWriteOff, creditSupplier,
}: {
  onApproveWriteOff: () => void;
  creditSupplier: boolean;
  res: Resolution;
  hideMoney: boolean;
  isAdmin: boolean;
  canAct: boolean;
  refundUploadingFor: string | null;
  confirmBankId: string | null;
  setConfirmBankId: (id: string | null) => void;
  onFileRefund: (file: File) => void;
  onConfirmBank: () => void;
  busy: boolean;
  cancelId: string | null;
  setCancelId: (id: string | null) => void;
  cancelReason: string;
  setCancelReason: (v: string) => void;
  onCancel: () => void;
  cancelErr: string;
}) {
  const writeOffWaiting = res.type === "WRITE_OFF" && res.status === "PENDING";
  const statusLabel = res.status === "COMPLETED" ? "Listo" : res.status === "CANCELLED" ? "Anulado" : writeOffWaiting ? "Espera al admin" : "En curso";
  const statusColor = res.status === "COMPLETED" ? "text-green" : res.status === "CANCELLED" ? "text-red" : "text-steel";
  return (
    <div className="bg-cloud rounded px-3 py-2 text-[11.5px]">
      <div className="flex items-center justify-between gap-2">
        <span className={`font-semibold ${res.status === "CANCELLED" ? "line-through text-steel" : ""}`}>{resolutionLabel(res, creditSupplier)} — {res.quantity} un.{hideMoney ? "" : ` · ${money(res.amount)}`}</span>
        <span className={`text-[10px] font-bold uppercase ${statusColor}`}>{statusLabel}</span>
      </div>
      <div className="text-steel-dim text-[10px] mt-0.5">Registrado por {actorName(res.createdBy?.name)} · {formatDateTime(res.createdAt)}</div>

      {res.status === "CANCELLED" && (
        <div className="text-red mt-0.5">Anulado por {actorName(res.cancelledBy?.name)}{res.cancelledAt ? ` · ${formatDateTime(res.cancelledAt)}` : ""}{res.cancelReason ? ` — ${res.cancelReason}` : ""}</div>
      )}

      {res.type === "CREDIT" && res.credit && (
        <div className="mt-0.5">
          <div className="text-steel">{res.credit.status === "AVAILABLE" ? (creditSupplier ? "No se paga — se descuenta de este pedido al armar la tanda" : "Disponible para la próxima compra a este proveedor") : res.credit.status === "APPLIED" ? (creditSupplier ? "Descontado en la tanda de pago" : "Ya aplicado a una compra") : res.credit.status === "CANCELLED" ? "Crédito anulado" : "Reembolsado"}</div>
          {res.credit.proofUrl && (
            <div className="mt-1.5"><ProofPreview url={res.credit.proofUrl} size={36} filename={res.credit.proofName ?? "comprobante-credito"} /></div>
          )}
          {res.credit.proofMismatchNote && (
            <div className="text-red mt-1 whitespace-pre-line">⚠️ {res.credit.proofMismatchNote}</div>
          )}
        </div>
      )}

      {res.type === "WRITE_OFF" && res.note && <div className="text-steel mt-0.5">{res.note}</div>}
      {writeOffWaiting && (
        <div className="mt-1" style={{ color: "var(--color-gold)" }}>
          {isAdmin ? "Si la apruebas, el proveedor cobra estas unidades aunque no se recuperen. Si no, anúlala con el motivo." : "Esperando aprobación del admin — mientras tanto este pedido no se paga."}
          {isAdmin && (
            <div className="mt-1.5">
              <button type="button" disabled={busy} className="rounded border border-green bg-green px-3 py-1.5 text-[11.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={onApproveWriteOff}>
                Aprobar pérdida
              </button>
            </div>
          )}
        </div>
      )}

      {res.type === "REPLACEMENT" && (
        <div className="text-steel mt-0.5">
          {res.status === "COMPLETED" ? (
            <>Verificado por {actorName(res.replacementVerifiedBy?.name)}{res.replacementArrivedAt ? ` · ${formatDateTime(res.replacementArrivedAt)}` : ""}{res.replacementAiNote ? ` — 🤖 ${res.replacementAiNote}` : ""}</>
          ) : (
            <>Esperando {res.replacementIsMissingDelivery ? "la entrega" : "el cambio"} — vence {res.replacementDueDate ? new Date(res.replacementDueDate).toLocaleDateString("es-MX") : "—"}</>
          )}
        </div>
      )}

      {res.type === "REFUND" && (
        <div className="mt-1.5">
          {!res.refundProofUrl ? (
            canAct ? (
              <ProofUploadLabel uploading={refundUploadingFor === res.id} onFile={onFileRefund}>
                Subir comprobante del proveedor
              </ProofUploadLabel>
            ) : (
              <div className="text-steel italic">Esperando el comprobante del proveedor.</div>
            )
          ) : (
            <div>
              <div className="mb-1"><ProofPreview url={res.refundProofUrl} size={40} filename="comprobante-reembolso" /></div>
              <div className={`flex items-center gap-1.5 ${res.refundAiMatch ? "text-teal" : "text-red"}`}>
                {res.refundAiMatch ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} 🤖 {res.refundAiNote}
                {!res.refundAiMatch && canAct && (
                  <label className="text-steel underline cursor-pointer ml-1">
                    cambiar
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFileRefund(e.target.files[0])} />
                  </label>
                )}
              </div>
            </div>
          )}
          {res.refundAiMatch && res.status === "PENDING" && isAdmin && (
            confirmBankId === res.id ? (
              <div className="bg-surface border border-gold/40 rounded-md p-2.5 mt-2" style={{ color: "var(--color-gold)" }}>
                <div className="text-[11.5px] font-semibold mb-1.5">¿Confirmas que revisaste tu cuenta bancaria y sí llegó {money(res.amount)}?</div>
                <div className="text-[11px] text-steel mb-2">Desde que confirmes, este reembolso queda bajo tu responsabilidad.</div>
                <div className="flex items-center gap-2">
                  <button type="button" disabled={busy} className="rounded border border-green bg-green px-3 py-1.5 text-[11.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={onConfirmBank}>Sí, confirmo que llegó</button>
                  <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => setConfirmBankId(null)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <button type="button" className="rounded border border-gold/50 px-2.5 py-1.5 text-[11px] font-semibold mt-1.5 cursor-pointer" style={{ color: "var(--color-gold)" }} onClick={() => setConfirmBankId(res.id)}>
                Confirmar que llegó el dinero
              </button>
            )
          )}
          {/* Confirmado 2026-09-16: quien registra/sube el comprobante
              (Compras) no puede confirmar el banco — eso es solo del admin
              (ver isAdmin arriba). Sin este aviso, Compras solo veía "En
              curso" y no tenía forma de saber si ya terminó su parte o si le
              falta algo a él. */}
          {res.refundAiMatch && res.status === "PENDING" && !isAdmin && canAct && (
            <div className="text-teal mt-1 flex items-center gap-1"><CheckCircle2 size={12} /> Ya quedó listo de tu parte — falta que el administrador confirme que el dinero llegó al banco.</div>
          )}
          {res.status === "COMPLETED" && <div className="text-green mt-1 flex items-center gap-1"><CheckCircle2 size={12} /> Confirmado el {res.bankConfirmedAt ? formatDateTime(res.bankConfirmedAt) : ""}</div>}
        </div>
      )}

      {isAdmin && canCancelResolution(res) && (
        cancelId === res.id ? (
          <div className="bg-surface border border-red/40 rounded-md p-2.5 mt-2">
            <div className="text-[11.5px] font-semibold text-red mb-1.5">¿Anular esta resolución?</div>
            <div className="text-[11px] text-steel mb-2">Las {res.quantity} un. vuelven a quedar sin resolver en el reporte.</div>
            <input
              type="text"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Motivo de la anulación"
              className="w-full border border-rule rounded px-2 py-1.5 text-[11.5px] mb-2"
            />
            {cancelErr && <div className="text-red text-[11px] mb-2">{cancelErr}</div>}
            <div className="flex items-center gap-2">
              <button type="button" disabled={busy} className="rounded border border-red bg-red px-3 py-1.5 text-[11.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={onCancel}>Sí, anular</button>
              <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => setCancelId(null)}>Cerrar</button>
            </div>
          </div>
        ) : (
          <button type="button" className="text-red text-[11px] font-semibold mt-1.5 cursor-pointer underline" onClick={() => setCancelId(res.id)}>
            Anular esta resolución
          </button>
        )
      )}
    </div>
  );
}
