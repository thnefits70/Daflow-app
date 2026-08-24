"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Pencil, Archive, RotateCcw, Upload, Camera } from "lucide-react";
import { usePasteFile } from "@/lib/usePasteFile";
import { uploadFile } from "@/lib/uploadFile";
import { ProofPreview } from "@/components/shared/ProofPreview";
import { LiveCameraCapture } from "@/components/shared/LiveCameraCapture";
import { TabGuide } from "@/components/shared/TabGuide";
import type { PettyCashBoxDTO, EligiblePaymentOrderDTO } from "@/lib/pettyCash";

function money(v: number) {
  return "$" + v.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function recentMonths(): string[] {
  const now = new Date();
  const months: string[] = [];
  for (let i = 0; i <= 11; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }
  return months;
}
function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${pad2(lastDay)}` };
}
const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function monthFilterLabel(month: string) {
  const [y, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

// Fix confirmado 2026-08-20: en Android, accept="image/*" sin más a veces
// abre el selector de fotos del sistema (que solo ofrece galería, sin
// opción de cámara) en vez de un chooser con cámara — a Nairoby no le
// abrió la cámara al tocar esa opción. "Tomar foto" evita ese selector
// del todo y abre la cámara en vivo dentro de la página (getUserMedia).
function UploadBox({ label, folder, onFile, onCaptured }: { label: string; folder: string; onFile: (file: File) => void; onCaptured: (url: string) => void }) {
  const { onPaste, onMouseEnter, onMouseLeave } = usePasteFile(onFile);
  const inputRef = useRef<HTMLInputElement>(null);
  const [takingPhoto, setTakingPhoto] = useState(false);

  if (takingPhoto) {
    return <LiveCameraCapture folder={folder} onCaptured={(url) => { setTakingPhoto(false); onCaptured(url); }} onCancel={() => setTakingPhoto(false)} />;
  }

  return (
    <label
      tabIndex={0}
      onPaste={onPaste}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => e.preventDefault()}
      className="flex flex-col items-center justify-center gap-1 border-[1.5px] border-dashed border-rule rounded-md py-4 cursor-pointer hover:border-teal transition-colors text-center"
    >
      <Upload size={16} className="text-steel" />
      <div className="text-[11.5px] font-semibold">{label}</div>
      <div className="text-[10px] text-steel">Pega la imagen aquí (Ctrl+V)</div>
      <div className="flex items-center gap-2.5">
        <button type="button" className="flex items-center gap-1 text-[10px] font-semibold text-blue cursor-pointer" onClick={(e) => { e.stopPropagation(); setTakingPhoto(true); }}>
          <Camera size={11} /> Tomar foto
        </button>
        <button type="button" className="text-[10px] underline decoration-dotted text-steel opacity-80 hover:opacity-100 cursor-pointer" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
          o selecciona un archivo
        </button>
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
    </label>
  );
}

// Confirmado 2026-08-06: doble clic sobre la miniatura del comprobante lo
// amplía sin salir de la pestaña — para poder verificarlo uno mismo antes
// (o además) de que la IA lo haga.
function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
      onClick={onClose}
    >
      <img src={url} alt="Comprobante ampliado" className="max-w-full max-h-full rounded-md shadow-lg" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

function ProofThumb({ url, onZoom }: { url: string; onZoom: () => void }) {
  return (
    <img
      src={url}
      alt="Comprobante"
      title="Doble clic para ampliar"
      onDoubleClick={onZoom}
      className="w-14 h-14 object-cover rounded border border-rule cursor-zoom-in shrink-0"
    />
  );
}

function EntryRow({
  entry, canManage, isAdmin, onEdit, onArchive, onRestore,
}: {
  entry: PettyCashBoxDTO["entries"][number];
  canManage: boolean;
  isAdmin: boolean;
  onEdit: (id: string, amount: number, description: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
}) {
  // Confirmado 2026-08-06: solo admin edita el monto de un fondeo (RECARGA)
  // — quien recibe el fondeo no decide cuánto le tocó, eso lo define quien
  // de verdad recarga la caja. Editar un DESEMBOLSO (su propio registro de
  // pago) sigue permitido para el manager de la caja.
  const canEditThis = entry.kind === "RECARGA" ? isAdmin : canManage;
  const [editing, setEditing] = useState(false);
  const [amt, setAmt] = useState(String(entry.amount));
  const [desc, setDesc] = useState(entry.description);

  return (
    <div className={`flex items-center justify-between gap-2.5 rounded-md px-3 py-2.5 text-[12.5px] ${entry.archived ? "bg-cloud/50 opacity-60" : "bg-cloud"}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-steel">#{entry.requestNumber}</span>
          <span className={`font-semibold truncate ${entry.archived ? "line-through" : ""}`}>{desc}</span>
        </div>
        {editing ? (
          <div className="flex items-center gap-1.5 mt-1">
            <input type="number" step="any" className="w-24 rounded border border-rule bg-bg px-2 py-1 text-[11px] font-mono" value={amt} onChange={(e) => setAmt(e.target.value)} />
            <input type="text" className="flex-1 rounded border border-rule bg-bg px-2 py-1 text-[11px]" value={desc} onChange={(e) => setDesc(e.target.value)} />
            <button type="button" className="text-teal text-[11px] font-semibold cursor-pointer" onClick={() => { onEdit(entry.id, Number(amt), desc); setEditing(false); }}>Guardar</button>
            <button type="button" className="text-steel text-[11px] cursor-pointer" onClick={() => setEditing(false)}>Cancelar</button>
          </div>
        ) : (
          <div className="text-steel text-[10.5px] mt-0.5">
            {entry.kind === "DESEMBOLSO" ? (entry.linkedOrderLabel ?? entry.manualReason ?? "Sin vínculo") : "Recarga"}
            {" · "}{fmtDate(entry.createdAt)} · {entry.createdByName}
            {entry.aiMatches === false && <span className="text-red"> · monto no coincide con la foto</span>}
          </div>
        )}
        {!editing && entry.proofUrl && (
          <div className="mt-1.5">
            <ProofPreview url={entry.proofUrl} size={40} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`font-mono font-semibold ${entry.kind === "DESEMBOLSO" ? "text-red" : "text-green"}`}>
          {entry.kind === "DESEMBOLSO" ? "−" : "+"}{money(entry.amount)}
        </span>
        {canManage && !editing && !entry.archived && (
          <>
            {canEditThis && (
              <button type="button" title="Editar" className="text-steel hover:text-ink cursor-pointer" onClick={() => setEditing(true)}><Pencil size={13} /></button>
            )}
            <button type="button" title="Archivar" className="text-steel hover:text-red cursor-pointer" onClick={() => onArchive(entry.id)}><Archive size={13} /></button>
          </>
        )}
        {canManage && entry.archived && (
          <button type="button" title="Restaurar" className="text-steel hover:text-teal cursor-pointer" onClick={() => onRestore(entry.id)}><RotateCcw size={13} /></button>
        )}
      </div>
    </div>
  );
}

function BoxCard({
  box, canManage, canFund, showOrderLink, eligibleOrders, isAdmin, highlight = false,
}: {
  box: PettyCashBoxDTO;
  canManage: boolean;
  canFund: boolean;
  showOrderLink: boolean;
  eligibleOrders: EligiblePaymentOrderDTO[];
  isAdmin: boolean;
  highlight?: boolean;
}) {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [glow, setGlow] = useState(false);

  useEffect(() => {
    if (!highlight) return;
    const el = document.getElementById(`caja-chica-${box.type.toLowerCase()}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    setGlow(true);
    const t = setTimeout(() => setGlow(false), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight]);

  const [linkMode, setLinkMode] = useState<"orden" | "motivo">("orden");
  const [groupId, setGroupId] = useState(eligibleOrders[0]?.groupId ?? "");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [proofVerifying, setProofVerifying] = useState(false);
  const [proofVerifyResult, setProofVerifyResult] = useState<{ matches: boolean; readAmount: number | null; note: string } | null>(null);

  const [fundAmount, setFundAmount] = useState("");
  const [fundDesc, setFundDesc] = useState("");
  const [fundProofUrl, setFundProofUrl] = useState<string | null>(null);
  const [fundUploading, setFundUploading] = useState(false);
  const [fundVerifying, setFundVerifying] = useState(false);
  const [fundVerifyResult, setFundVerifyResult] = useState<{ matches: boolean; readAmount: number | null; note: string } | null>(null);

  const [excReason, setExcReason] = useState("");
  const [zoomedUrl, setZoomedUrl] = useState<string | null>(null);

  const acc = box.payoutAccount;
  const [editingPayout, setEditingPayout] = useState(false);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [bankNames, setBankNames] = useState<string[]>([]);
  const [pBankName, setPBankName] = useState(acc?.bankName ?? "");
  const [pBankAccountType, setPBankAccountType] = useState(acc?.bankAccountType ?? "Ahorros");
  const [pBankAccountNumber, setPBankAccountNumber] = useState(acc?.bankAccountNumber ?? "");
  const [pBankAccountHolder, setPBankAccountHolder] = useState(acc?.bankAccountHolder ?? "");
  const [pHolderIdType, setPHolderIdType] = useState<"RUC" | "CEDULA">(acc?.holderIdType ?? "CEDULA");
  const [pHolderIdNumber, setPHolderIdNumber] = useState(acc?.holderIdNumber ?? "");
  const [pEmail, setPEmail] = useState(acc?.email ?? "");
  const [pPhone, setPPhone] = useState(acc?.phone ?? "");

  useEffect(() => {
    if (!editingPayout || bankNames.length > 0) return;
    fetch("/api/employee-bank-account/bank-names").then((r) => (r.ok ? r.json() : [])).then(setBankNames);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingPayout]);

  function cancelEditPayout() {
    setPBankName(acc?.bankName ?? ""); setPBankAccountType(acc?.bankAccountType ?? "Ahorros");
    setPBankAccountNumber(acc?.bankAccountNumber ?? ""); setPBankAccountHolder(acc?.bankAccountHolder ?? "");
    setPHolderIdType(acc?.holderIdType ?? "CEDULA"); setPHolderIdNumber(acc?.holderIdNumber ?? "");
    setPEmail(acc?.email ?? ""); setPPhone(acc?.phone ?? "");
    setEditingPayout(false);
  }

  async function savePayoutAccount() {
    if (!pBankName.trim() || !pBankAccountNumber.trim() || !pBankAccountHolder.trim()) { setErr("Completa banco, número de cuenta y titular."); return; }
    setPayoutBusy(true);
    setErr("");
    const res = await fetch("/api/petty-cash/box", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        boxType: box.type,
        bankName: pBankName.trim(), bankAccountType: pBankAccountType, bankAccountNumber: pBankAccountNumber.trim(),
        bankAccountHolder: pBankAccountHolder.trim(), holderIdType: pHolderIdType, holderIdNumber: pHolderIdNumber.trim() || undefined,
        email: pEmail.trim() || undefined, phone: pPhone.trim() || undefined,
      }),
    });
    setPayoutBusy(false);
    if (!res.ok) { const json = await res.json().catch(() => null); setErr(json?.error ?? "No se pudo guardar la cuenta."); return; }
    setEditingPayout(false);
    router.refresh();
  }

  // Confirmado 2026-08-06: filtro de fechas para el historial de esta caja —
  // mismo patrón (desde/hasta + selector de mes + "Mes anterior") ya usado
  // en Facturación de Control de Compras y Pagos administrativos.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<"todos" | "ingresos" | "salidas">("todos");

  // Fix confirmado 2026-08-11: pedido explícito del usuario — confirmar que
  // llegó el fondeo y registrar un desembolso son acciones EXCLUSIVAS de
  // quien de verdad administra la caja del día a día (Bryan en Secundaria) —
  // canManage sigue siendo true para admin (ve, funda, puede editar/archivar
  // el historial), pero admin nunca debe ver ni usar estas dos acciones
  // puntuales, que le corresponden solo al dueño real de la caja.
  const canOperate = canManage && !isAdmin;
  const blocked = box.blocked && canOperate;
  const myPending = box.pendingRecharges[0];

  async function verifyProof(target: "desembolso" | "recarga", url: string, expected: number) {
    if (target === "desembolso") { setProofVerifying(true); setProofVerifyResult(null); } else { setFundVerifying(true); setFundVerifyResult(null); }
    const res = await fetch("/api/petty-cash/verify-proof", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boxType: box.type, proofUrl: url, expectedAmount: expected }),
    });
    const data = await res.json().catch(() => null);
    if (target === "desembolso") setProofVerifying(false); else setFundVerifying(false);
    if (!res.ok) { setErr(data?.error ?? "No se pudo verificar el comprobante."); return; }
    if (target === "desembolso") setProofVerifyResult(data); else setFundVerifyResult(data);
  }

  function applyProof(target: "desembolso" | "recarga", url: string) {
    if (target === "desembolso") {
      setProofUrl(url);
      setProofVerifyResult(null);
      const n = Number(amount);
      if (!Number.isNaN(n) && n > 0) verifyProof("desembolso", url, n);
    } else {
      setFundProofUrl(url);
      setFundVerifyResult(null);
      const n = Number(fundAmount);
      if (!Number.isNaN(n) && n > 0) verifyProof("recarga", url, n);
    }
  }

  async function doUpload(file: File, target: "desembolso" | "recarga") {
    if (target === "desembolso") setUploading(true); else setFundUploading(true);
    const res = await uploadFile(file, "petty-cash");
    if (target === "desembolso") setUploading(false); else setFundUploading(false);
    if (!res.ok) { setErr(res.error); return; }
    applyProof(target, res.url);
  }

  async function confirmReceived() {
    if (!myPending) return;
    setBusy(true);
    const res = await fetch(`/api/petty-cash/recharge/${myPending.id}/confirm`, { method: "PATCH" });
    setBusy(false);
    if (!res.ok) { setErr("No se pudo confirmar."); return; }
    router.refresh();
  }

  async function submitDesembolso() {
    const n = Number(amount);
    if (Number.isNaN(n) || n <= 0) { setErr("Ingresa un monto válido."); return; }
    if (!description.trim()) { setErr("Escribe una descripción."); return; }
    if (proofUrl && proofVerifyResult?.matches === false) { setErr("El comprobante no coincide con el monto — cambia la foto o corrige el monto antes de guardar."); return; }
    setBusy(true);
    setErr("");
    const res = await fetch("/api/petty-cash/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        boxType: box.type, amount: n, description, proofUrl,
        linkedGroupId: showOrderLink && linkMode === "orden" ? groupId : null,
        manualReason: showOrderLink && linkMode === "motivo" ? reason : (!showOrderLink ? null : null),
      }),
    });
    setBusy(false);
    const json = await res.json().catch(() => null);
    if (!res.ok) { setErr(json?.error ?? "No se pudo guardar."); return; }
    setAmount(""); setDescription(""); setProofUrl(null); setReason(""); setProofVerifyResult(null);
    router.refresh();
  }

  function clearDesembolso() {
    setAmount(""); setDescription(""); setProofUrl(null); setReason(""); setProofVerifyResult(null); setErr("");
  }

  async function submitFund() {
    const n = Number(fundAmount);
    if (Number.isNaN(n) || n <= 0) { setErr("Ingresa un monto válido."); return; }
    if (fundProofUrl && fundVerifyResult?.matches === false) { setErr("El comprobante no coincide con el monto — cambia la foto o corrige el monto antes de enviar."); return; }
    setBusy(true);
    setErr("");
    const res = await fetch("/api/petty-cash/recharge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boxType: box.type, amount: n, description: fundDesc || "Fondeo de caja chica", proofUrl: fundProofUrl }),
    });
    setBusy(false);
    const json = await res.json().catch(() => null);
    if (!res.ok) { setErr(json?.error ?? "No se pudo enviar."); return; }
    setFundAmount(""); setFundDesc(""); setFundProofUrl(null); setFundVerifyResult(null);
    router.refresh();
  }

  async function submitException() {
    if (!groupId || !excReason.trim()) { setErr("Elige la orden y escribe el motivo."); return; }
    setBusy(true);
    setErr("");
    const res = await fetch("/api/petty-cash/exceptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId, reason: excReason }),
    });
    setBusy(false);
    const json = await res.json().catch(() => null);
    if (!res.ok) { setErr(json?.error ?? "No se pudo enviar."); return; }
    setExcReason("");
    router.refresh();
  }

  const filteredEntries = box.entries.filter((e) => {
    if (kindFilter === "ingresos" && e.kind !== "RECARGA") return false;
    if (kindFilter === "salidas" && e.kind !== "DESEMBOLSO") return false;
    if (dateFrom || dateTo) {
      const d = e.createdAt.slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
    }
    return true;
  });

  return (
    <div
      id={`caja-chica-${box.type.toLowerCase()}`}
      className={`bg-surface border rounded-md p-4.5 transition-shadow duration-500 ${glow ? "border-teal shadow-[0_0_0_3px_rgba(20,199,199,0.25)]" : "border-rule"}`}
    >
      {err && <div className="text-red text-[12px] mb-2.5">{err}</div>}

      <div className="flex items-center justify-between mb-1">
        <div className="font-semibold text-[14px]">{box.type === "PRINCIPAL" ? "💰 Caja Chica Principal" : "🧾 Caja Chica Secundaria"}</div>
        {!canManage && <span className="font-mono text-[10px] uppercase text-steel bg-cloud rounded-full px-2 py-0.5">Solo lectura</span>}
      </div>
      <div className={`font-display text-[28px] font-bold mt-1 ${box.isLow ? "text-red" : ""}`}>{money(box.balance)}</div>
      {box.isLow && (
        <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-red bg-red/10 border border-red/30 rounded-md px-2.5 py-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red shrink-0" /> Saldo bajo el mínimo de {money(box.minThreshold)}.
        </div>
      )}

      {myPending && canOperate && (
        <div className="mt-3 bg-blue/10 border border-blue/30 rounded-md p-3">
          <div className="text-[12px] font-semibold mb-1">📥 Te fondearon la caja — confírmalo</div>
          <div className="text-[11px] text-steel mb-2">{myPending.description}</div>
          <div className="font-mono text-[15px] font-bold mb-2">{money(myPending.amount)}</div>
          <button type="button" disabled={busy} className="rounded bg-blue text-white px-3.5 py-1.5 text-[12px] font-semibold cursor-pointer disabled:opacity-60" onClick={confirmReceived}>
            ✓ Sí, recibí {money(myPending.amount)}
          </button>
        </div>
      )}
      {blocked && (
        <div className="mt-2.5 text-[11px] text-red bg-red/10 border border-red/30 rounded-md px-2.5 py-1.5">
          🔒 No puedes registrar desembolsos ni pedir excepciones hasta confirmar la recarga de arriba.
        </div>
      )}

      <div className="mt-3.5">
        {box.entries.length > 0 && (
          <div className="flex items-center gap-1.5 mb-2.5 flex-wrap text-[11px]">
            <div className="flex rounded border border-rule overflow-hidden">
              <button type="button" className={`px-2 py-1 cursor-pointer ${kindFilter === "todos" ? "bg-blue text-white" : "bg-cloud text-steel"}`} onClick={() => setKindFilter("todos")}>Todos</button>
              <button type="button" className={`px-2 py-1 cursor-pointer border-l border-rule ${kindFilter === "ingresos" ? "bg-green text-white" : "bg-cloud text-steel"}`} onClick={() => setKindFilter("ingresos")}>Ingresos</button>
              <button type="button" className={`px-2 py-1 cursor-pointer border-l border-rule ${kindFilter === "salidas" ? "bg-red text-white" : "bg-cloud text-steel"}`} onClick={() => setKindFilter("salidas")}>Salidas</button>
            </div>
            <select
              className="rounded border border-rule bg-cloud px-2 py-1 font-mono"
              value={monthFilter}
              onChange={(e) => {
                const month = e.target.value;
                setMonthFilter(month);
                if (!month) { setDateFrom(""); setDateTo(""); return; }
                const { from, to } = monthBounds(month);
                setDateFrom(from);
                setDateTo(to);
              }}
            >
              <option value="">Todos los meses</option>
              {recentMonths().map((m) => (
                <option key={m} value={m}>{monthFilterLabel(m)}</option>
              ))}
            </select>
            <button
              type="button"
              className="rounded border border-rule px-2 py-1 text-steel cursor-pointer hover:border-teal"
              onClick={() => {
                const now = new Date();
                const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const month = `${prev.getFullYear()}-${pad2(prev.getMonth() + 1)}`;
                setMonthFilter(month);
                const { from, to } = monthBounds(month);
                setDateFrom(from);
                setDateTo(to);
              }}
            >
              Mes anterior
            </button>
            <label className="flex items-center gap-1 text-steel">
              Desde
              <input type="date" className="rounded border border-rule bg-cloud px-1.5 py-1" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setMonthFilter(""); }} />
            </label>
            <label className="flex items-center gap-1 text-steel">
              Hasta
              <input type="date" className="rounded border border-rule bg-cloud px-1.5 py-1" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setMonthFilter(""); }} />
            </label>
            {(dateFrom || dateTo || kindFilter !== "todos") && (
              <button type="button" className="text-steel underline cursor-pointer" onClick={() => { setMonthFilter(""); setDateFrom(""); setDateTo(""); setKindFilter("todos"); }}>Limpiar</button>
            )}
          </div>
        )}
        {box.entries.length === 0 && <div className="text-steel text-[12px]">Sin movimientos todavía.</div>}
        {box.entries.length > 0 && filteredEntries.length === 0 && (
          <div className="text-steel text-[12px]">Nada con ese filtro.</div>
        )}
        <div className="flex flex-col gap-1.5">
          {filteredEntries.map((e) => (
            <EntryRow
              key={e.id} entry={e} canManage={canManage} isAdmin={isAdmin}
              onEdit={async (id, amt, desc) => {
                await fetch(`/api/petty-cash/entries/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "edit", amount: amt, description: desc }) });
                router.refresh();
              }}
              onArchive={async (id) => {
                await fetch(`/api/petty-cash/entries/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "archive" }) });
                router.refresh();
              }}
              onRestore={async (id) => {
                await fetch(`/api/petty-cash/entries/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore" }) });
                router.refresh();
              }}
            />
          ))}
        </div>
      </div>

      {box.archivedEntries.length > 0 && (
        <div className="mt-2.5">
          <button type="button" className="text-steel text-[11px] cursor-pointer hover:text-ink" onClick={() => setShowArchived((v) => !v)}>
            🗄 {showArchived ? "Ocultar" : "Ver"} archivados ({box.archivedEntries.length})
          </button>
          {showArchived && (
            <div className="flex flex-col gap-1.5 mt-2">
              {box.archivedEntries.map((e) => (
                <EntryRow key={e.id} entry={e} canManage={canManage} isAdmin={isAdmin}
                  onEdit={() => {}}
                  onArchive={() => {}}
                  onRestore={async (id) => {
                    await fetch(`/api/petty-cash/entries/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore" }) });
                    router.refresh();
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {canOperate && (
        <div className="mt-3.5 pt-3.5 border-t border-dashed border-rule">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[12px] font-semibold">🏦 Cuenta para recibir fondeo</div>
            {!editingPayout && (
              <button type="button" className="text-steel hover:text-ink shrink-0 cursor-pointer" title="Editar" onClick={() => setEditingPayout(true)}><Pencil size={13} /></button>
            )}
          </div>
          {editingPayout ? (
            <div className="flex flex-col gap-1.5 max-w-sm">
              <input list="bank-names-datalist" type="text" placeholder="Banco" className="rounded border border-rule bg-cloud px-2.5 py-1.5 text-[12px]" value={pBankName} onChange={(e) => setPBankName(e.target.value)} autoFocus />
              <datalist id="bank-names-datalist">{bankNames.map((n) => (<option key={n} value={n} />))}</datalist>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setPBankAccountType("Ahorros")} className={`flex-1 text-[11.5px] font-semibold rounded px-2 py-1.5 border cursor-pointer ${pBankAccountType === "Ahorros" ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}>Ahorros</button>
                <button type="button" onClick={() => setPBankAccountType("Corriente")} className={`flex-1 text-[11.5px] font-semibold rounded px-2 py-1.5 border cursor-pointer ${pBankAccountType === "Corriente" ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}>Corriente</button>
              </div>
              <input type="text" placeholder="N° de cuenta" className="rounded border border-rule bg-cloud px-2.5 py-1.5 text-[12px]" value={pBankAccountNumber} onChange={(e) => setPBankAccountNumber(e.target.value)} />
              <input type="text" placeholder="Nombre del titular" className="rounded border border-rule bg-cloud px-2.5 py-1.5 text-[12px]" value={pBankAccountHolder} onChange={(e) => setPBankAccountHolder(e.target.value)} />
              <div className="flex gap-1.5">
                <select className="rounded border border-rule bg-cloud px-2 py-1.5 text-[12px]" value={pHolderIdType} onChange={(e) => setPHolderIdType(e.target.value as "RUC" | "CEDULA")}>
                  <option value="CEDULA">Cédula</option>
                  <option value="RUC">RUC</option>
                </select>
                <input type="text" placeholder="N° de identificación" className="flex-1 rounded border border-rule bg-cloud px-2.5 py-1.5 text-[12px]" value={pHolderIdNumber} onChange={(e) => setPHolderIdNumber(e.target.value)} />
              </div>
              <input type="email" placeholder="Correo (opcional)" className="rounded border border-rule bg-cloud px-2.5 py-1.5 text-[12px]" value={pEmail} onChange={(e) => setPEmail(e.target.value)} />
              <input type="text" placeholder="Celular (opcional)" className="rounded border border-rule bg-cloud px-2.5 py-1.5 text-[12px]" value={pPhone} onChange={(e) => setPPhone(e.target.value)} />
              <div className="flex items-center gap-2.5 mt-0.5">
                <button type="button" disabled={payoutBusy} className="text-teal text-[11.5px] font-semibold cursor-pointer disabled:opacity-60" onClick={savePayoutAccount}>{payoutBusy ? "Guardando…" : "Guardar"}</button>
                <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={cancelEditPayout}>Cancelar</button>
              </div>
            </div>
          ) : acc ? (
            <div className="text-[12px] leading-relaxed">
              <div>{acc.bankName} — {acc.bankAccountType}</div>
              <div className="text-steel">N° cuenta: <span className="text-ink">{acc.bankAccountNumber}</span></div>
              <div className="text-steel">Titular: <span className="text-ink">{acc.bankAccountHolder}</span>{acc.holderIdNumber && <> — {acc.holderIdType === "RUC" ? "RUC" : "Cédula"} {acc.holderIdNumber}</>}</div>
              {acc.email && <div className="text-steel">Correo: <span className="text-ink">{acc.email}</span></div>}
              {acc.phone && <div className="text-steel">Celular: <span className="text-ink">{acc.phone}</span></div>}
            </div>
          ) : (
            <div className="text-[12px] text-steel italic">Sin cuenta configurada</div>
          )}
        </div>
      )}

      {canOperate && !blocked && (
        <div className="mt-4 pt-3.5 border-t border-dashed border-rule">
          <div className="text-[12px] font-semibold mb-2">Registrar solicitud de pago</div>
          {showOrderLink && (
            <div className="flex gap-1.5 mb-2.5">
              <button type="button" className={`flex-1 rounded px-2 py-1.5 text-[11px] font-semibold cursor-pointer ${linkMode === "orden" ? "bg-blue text-white" : "bg-cloud text-steel"}`} onClick={() => setLinkMode("orden")}>🚚 Flete</button>
              <button type="button" className={`flex-1 rounded px-2 py-1.5 text-[11px] font-semibold cursor-pointer ${linkMode === "motivo" ? "bg-blue text-white" : "bg-cloud text-steel"}`} onClick={() => setLinkMode("motivo")}>✏️ Otro gasto</button>
            </div>
          )}
          {showOrderLink && linkMode === "orden" && (
            <select className="w-full rounded border border-rule bg-cloud px-2.5 py-2 text-[12px] mb-2.5" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              {eligibleOrders.length === 0 && <option value="">No hay órdenes con flete pendiente</option>}
              {eligibleOrders.map((o) => <option key={o.groupId} value={o.groupId}>{o.label}</option>)}
            </select>
          )}
          {showOrderLink && linkMode === "motivo" && (
            <input type="text" placeholder="Motivo del pago" className="w-full rounded border border-rule bg-cloud px-2.5 py-2 text-[12px] mb-2.5" value={reason} onChange={(e) => setReason(e.target.value)} />
          )}
          <input type="text" placeholder="Descripción" className="w-full rounded border border-rule bg-cloud px-2.5 py-2 text-[12px] mb-2.5" value={description} onChange={(e) => setDescription(e.target.value)} />
          <input type="number" step="any" placeholder="$0.00" className="w-full rounded border border-rule bg-cloud px-2.5 py-2 text-[12px] font-mono mb-2.5" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {proofUrl ? (
            <div className="flex items-start gap-2.5 mb-2.5">
              <ProofThumb url={proofUrl} onZoom={() => setZoomedUrl(proofUrl)} />
              <div className="flex-1 min-w-0 text-[11.5px]">
                {proofVerifying ? (
                  <span className="text-steel flex items-center gap-1.5"><span className="w-3 h-3 rounded-full border-2 border-rule border-t-teal animate-spin shrink-0" /> Verificando con IA…</span>
                ) : proofVerifyResult?.matches ? (
                  <span className="text-teal flex items-center gap-1"><CheckCircle2 size={13} /> {proofVerifyResult.note}</span>
                ) : proofVerifyResult ? (
                  <span className="text-red">{proofVerifyResult.note}</span>
                ) : (
                  <span className="text-teal flex items-center gap-1"><CheckCircle2 size={13} /> Comprobante listo — doble clic para ampliar</span>
                )}
                <div className="flex items-center gap-2.5 mt-1">
                  <button type="button" className="text-steel underline cursor-pointer" onClick={() => { setProofUrl(null); setProofVerifyResult(null); }}>Cambiar foto</button>
                  {!proofVerifying && (
                    <button
                      type="button"
                      className="text-steel underline cursor-pointer"
                      onClick={() => { const n = Number(amount); if (!Number.isNaN(n) && n > 0) verifyProof("desembolso", proofUrl, n); else setErr("Ingresa el monto antes de verificar."); }}
                    >
                      Verificar de nuevo
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="mb-2.5">{uploading ? <div className="text-[11.5px] text-steel">Subiendo…</div> : <UploadBox label="📷 Subir comprobante" folder="petty-cash" onFile={(f) => doUpload(f, "desembolso")} onCaptured={(url) => applyProof("desembolso", url)} />}</div>
          )}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={busy || proofVerifying || (!!proofUrl && proofVerifyResult?.matches === false)}
              className="rounded bg-blue text-white px-3.5 py-2 text-[12.5px] font-semibold cursor-pointer disabled:opacity-60"
              onClick={submitDesembolso}
            >
              Guardar desembolso
            </button>
            {(description || amount || proofUrl) && (
              <button
                type="button"
                disabled={busy}
                className="text-steel text-[11.5px] cursor-pointer disabled:opacity-60"
                onClick={clearDesembolso}
              >
                Cancelar / borrar
              </button>
            )}
          </div>

          {showOrderLink && (
            <div className="mt-4 pt-3 border-t border-dashed border-rule">
              <div className="text-[11px] font-semibold mb-1.5">¿Una orden ya tiene el flete pagado y necesitas un 2do pago real?</div>
              <select className="w-full rounded border border-rule bg-cloud px-2.5 py-2 text-[11.5px] mb-2" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                {eligibleOrders.map((o) => <option key={o.groupId} value={o.groupId}>{o.label}</option>)}
              </select>
              <textarea rows={2} placeholder="Explica por qué hace falta un segundo pago…" className="w-full rounded border border-rule bg-cloud px-2.5 py-2 text-[11.5px] mb-2 resize-none" value={excReason} onChange={(e) => setExcReason(e.target.value)} />
              <button type="button" disabled={busy} className="rounded border border-rule text-steel px-3 py-1.5 text-[11.5px] cursor-pointer disabled:opacity-60" onClick={submitException}>
                Enviar excepción al dueño
              </button>
            </div>
          )}
        </div>
      )}

      {canFund && isAdmin && (
        <div className="mt-4 pt-3.5 border-t border-dashed border-rule">
          <div className="text-[12px] font-semibold mb-2">💸 Fondear esta caja</div>
          {acc ? (
            <div className="mb-2.5 text-[11.5px] bg-teal/10 border border-teal/30 rounded-md px-2.5 py-1.5 leading-relaxed">
              <div className="font-semibold">🏦 Transferir a:</div>
              <div>{acc.bankName} — {acc.bankAccountType} — {acc.bankAccountNumber}</div>
              <div>{acc.bankAccountHolder}{acc.holderIdNumber && <> — {acc.holderIdType === "RUC" ? "RUC" : "Cédula"} {acc.holderIdNumber}</>}</div>
              {acc.email && <div>Correo: {acc.email}</div>}
              {acc.phone && <div>Celular: {acc.phone}</div>}
            </div>
          ) : (
            <div className="mb-2.5 text-[11.5px] text-steel bg-cloud rounded-md px-2.5 py-1.5">
              Aún no configuran una cuenta de destino para esta caja.
            </div>
          )}
          <input type="number" step="any" placeholder="Monto que entregas" className="w-full rounded border border-rule bg-cloud px-2.5 py-2 text-[12px] font-mono mb-2" value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} />
          <input type="text" placeholder="Descripción (opcional)" className="w-full rounded border border-rule bg-cloud px-2.5 py-2 text-[12px] mb-2" value={fundDesc} onChange={(e) => setFundDesc(e.target.value)} />
          {fundProofUrl ? (
            <div className="flex items-start gap-2.5 mb-2">
              <ProofThumb url={fundProofUrl} onZoom={() => setZoomedUrl(fundProofUrl)} />
              <div className="flex-1 min-w-0 text-[11.5px]">
                {fundVerifying ? (
                  <span className="text-steel flex items-center gap-1.5"><span className="w-3 h-3 rounded-full border-2 border-rule border-t-teal animate-spin shrink-0" /> Verificando con IA…</span>
                ) : fundVerifyResult?.matches ? (
                  <span className="text-teal flex items-center gap-1"><CheckCircle2 size={13} /> {fundVerifyResult.note}</span>
                ) : fundVerifyResult ? (
                  <span className="text-red">{fundVerifyResult.note}</span>
                ) : (
                  <span className="text-teal flex items-center gap-1"><CheckCircle2 size={13} /> Evidencia lista — doble clic para ampliar</span>
                )}
                <div className="flex items-center gap-2.5 mt-1">
                  <button type="button" className="text-steel underline cursor-pointer" onClick={() => { setFundProofUrl(null); setFundVerifyResult(null); }}>Cambiar foto</button>
                  {!fundVerifying && (
                    <button
                      type="button"
                      className="text-steel underline cursor-pointer"
                      onClick={() => { const n = Number(fundAmount); if (!Number.isNaN(n) && n > 0) verifyProof("recarga", fundProofUrl, n); else setErr("Ingresa el monto antes de verificar."); }}
                    >
                      Verificar de nuevo
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="mb-2">{fundUploading ? <div className="text-[11.5px] text-steel">Subiendo…</div> : <UploadBox label="📷 Evidencia de entrega/retiro" folder="petty-cash" onFile={(f) => doUpload(f, "recarga")} onCaptured={(url) => applyProof("recarga", url)} />}</div>
          )}
          <button
            type="button"
            disabled={busy || fundVerifying || (!!fundProofUrl && fundVerifyResult?.matches === false)}
            className="rounded border border-blue text-blue px-3.5 py-2 text-[12.5px] font-semibold cursor-pointer disabled:opacity-60"
            onClick={submitFund}
          >
            Enviar — queda pendiente que confirmen
          </button>
        </div>
      )}

      {zoomedUrl && <Lightbox url={zoomedUrl} onClose={() => setZoomedUrl(null)} />}
    </div>
  );
}

export function PettyCashPanel({
  principal, secundaria, canManagePrincipal, canManageSecundaria, canFundPrincipal, canFundSecundaria, eligibleOrders, isAdmin = false, focusBox = null,
}: {
  principal: PettyCashBoxDTO | null;
  secundaria: PettyCashBoxDTO | null;
  canManagePrincipal: boolean;
  canManageSecundaria: boolean;
  canFundPrincipal: boolean;
  canFundSecundaria: boolean;
  eligibleOrders: EligiblePaymentOrderDTO[];
  isAdmin?: boolean;
  // Confirmado 2026-08-06: "principal" | "secundaria" (en minúscula, viene
  // del query param ?box=... armado en src/lib/pendingTasks.ts) — hace
  // scroll y resalta esa caja cuando se llega desde un aviso de Pendientes.
  focusBox?: string | null;
}) {
  const operates = (canManagePrincipal || canManageSecundaria) && !isAdmin;

  return (
    <div>
      <TabGuide storageKey="cajachica">
        {isAdmin ? (
          <>Ves ambas cajas. Fondéalas cuando alguien te pida transferir, y puedes editar o archivar movimientos del historial si hace falta corregir algo — pero registrar un desembolso o confirmar que llegó el fondeo es exclusivo de quien administra cada caja el día a día (Nairoby en Principal, Bryan en Secundaria).</>
        ) : operates && canManageSecundaria ? (
          <>Esta es tu caja del día a día. Confirma cuando te fondeen, y registra cada desembolso con su comprobante — la IA verifica que el monto coincida. Puedes vincular el pago a una orden con flete pendiente o escribir el motivo a mano; si una orden ya tiene el flete pagado y necesitas un segundo pago, pide la excepción al dueño.</>
        ) : operates ? (
          <>Esta es tu caja del día a día. Confirma cuando te fondeen, registra cada desembolso con su comprobante (la IA verifica que el monto coincida), y configura la cuenta donde quieres recibir el fondeo.</>
        ) : (
          <>Vista de solo lectura de las cajas chicas. Fondear, registrar desembolsos y confirmar recargas es exclusivo de quien administra cada caja.</>
        )}
      </TabGuide>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {principal && <BoxCard box={principal} canManage={canManagePrincipal} canFund={canFundPrincipal} showOrderLink={false} eligibleOrders={[]} isAdmin={isAdmin} highlight={focusBox === "principal"} />}
        {secundaria && <BoxCard box={secundaria} canManage={canManageSecundaria} canFund={canFundSecundaria} showOrderLink={true} eligibleOrders={eligibleOrders} isAdmin={isAdmin} highlight={focusBox === "secundaria"} />}
      </div>
    </div>
  );
}
