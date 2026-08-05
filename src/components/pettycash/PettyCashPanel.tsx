"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Pencil, Archive, RotateCcw, Upload } from "lucide-react";
import { usePasteFile } from "@/lib/usePasteFile";
import { uploadFile } from "@/lib/uploadFile";
import type { PettyCashBoxDTO, EligiblePaymentOrderDTO } from "@/lib/pettyCash";

function money(v: number) {
  return "$" + v.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

function UploadBox({ label, onFile }: { label: string; onFile: (file: File) => void }) {
  const { onPaste, onMouseEnter, onMouseLeave } = usePasteFile(onFile);
  return (
    <label
      onPaste={onPaste}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="flex flex-col items-center justify-center gap-1 border-[1.5px] border-dashed border-rule rounded-md py-4 cursor-pointer hover:border-teal transition-colors text-center"
    >
      <Upload size={16} className="text-steel" />
      <div className="text-[11.5px] font-semibold">{label}</div>
      <div className="text-[10px] text-steel">Clic, arrastra, o pasa el mouse aquí y Ctrl+V</div>
      <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
    </label>
  );
}

function EntryRow({
  entry, canManage, onEdit, onArchive, onRestore,
}: {
  entry: PettyCashBoxDTO["entries"][number];
  canManage: boolean;
  onEdit: (id: string, amount: number, description: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
}) {
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
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`font-mono font-semibold ${entry.kind === "DESEMBOLSO" ? "text-red" : "text-green"}`}>
          {entry.kind === "DESEMBOLSO" ? "−" : "+"}{money(entry.amount)}
        </span>
        {canManage && !editing && !entry.archived && (
          <>
            <button type="button" title="Editar" className="text-steel hover:text-ink cursor-pointer" onClick={() => setEditing(true)}><Pencil size={13} /></button>
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
  box, canManage, canFund, showOrderLink, eligibleOrders,
}: {
  box: PettyCashBoxDTO;
  canManage: boolean;
  canFund: boolean;
  showOrderLink: boolean;
  eligibleOrders: EligiblePaymentOrderDTO[];
}) {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [linkMode, setLinkMode] = useState<"orden" | "motivo">("orden");
  const [groupId, setGroupId] = useState(eligibleOrders[0]?.groupId ?? "");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [fundAmount, setFundAmount] = useState("");
  const [fundDesc, setFundDesc] = useState("");
  const [fundProofUrl, setFundProofUrl] = useState<string | null>(null);
  const [fundUploading, setFundUploading] = useState(false);

  const [excReason, setExcReason] = useState("");

  const blocked = box.blocked && canManage;
  const myPending = box.pendingRecharges[0];

  async function doUpload(file: File, target: "desembolso" | "recarga") {
    if (target === "desembolso") setUploading(true); else setFundUploading(true);
    const res = await uploadFile(file, "petty-cash");
    if (target === "desembolso") setUploading(false); else setFundUploading(false);
    if (!res.ok) { setErr(res.error); return; }
    if (target === "desembolso") setProofUrl(res.url); else setFundProofUrl(res.url);
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
    setAmount(""); setDescription(""); setProofUrl(null); setReason("");
    router.refresh();
  }

  async function submitFund() {
    const n = Number(fundAmount);
    if (Number.isNaN(n) || n <= 0) { setErr("Ingresa un monto válido."); return; }
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
    setFundAmount(""); setFundDesc(""); setFundProofUrl(null);
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

  return (
    <div className="bg-surface border border-rule rounded-md p-4.5">
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

      {myPending && (
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
        {box.entries.length === 0 && <div className="text-steel text-[12px]">Sin movimientos todavía.</div>}
        <div className="flex flex-col gap-1.5">
          {box.entries.map((e) => (
            <EntryRow
              key={e.id} entry={e} canManage={canManage}
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
                <EntryRow key={e.id} entry={e} canManage={canManage}
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

      {canManage && !blocked && (
        <div className="mt-4 pt-3.5 border-t border-dashed border-rule">
          <div className="text-[12px] font-semibold mb-2">Registrar solicitud de pago</div>
          {showOrderLink && (
            <div className="flex gap-1.5 mb-2.5">
              <button type="button" className={`flex-1 rounded px-2 py-1.5 text-[11px] font-semibold cursor-pointer ${linkMode === "orden" ? "bg-blue text-white" : "bg-cloud text-steel"}`} onClick={() => setLinkMode("orden")}>📦 Orden de pago</button>
              <button type="button" className={`flex-1 rounded px-2 py-1.5 text-[11px] font-semibold cursor-pointer ${linkMode === "motivo" ? "bg-blue text-white" : "bg-cloud text-steel"}`} onClick={() => setLinkMode("motivo")}>✏️ Sin orden — motivo</button>
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
            <div className="flex items-center gap-2 text-[11.5px] text-teal mb-2.5"><CheckCircle2 size={13} /> Comprobante listo</div>
          ) : (
            <div className="mb-2.5">{uploading ? <div className="text-[11.5px] text-steel">Subiendo…</div> : <UploadBox label="📷 Subir comprobante" onFile={(f) => doUpload(f, "desembolso")} />}</div>
          )}
          <button type="button" disabled={busy} className="rounded bg-blue text-white px-3.5 py-2 text-[12.5px] font-semibold cursor-pointer disabled:opacity-60" onClick={submitDesembolso}>
            Guardar desembolso
          </button>

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

      {canFund && (
        <div className="mt-4 pt-3.5 border-t border-dashed border-rule">
          <div className="text-[12px] font-semibold mb-2">💸 Fondear esta caja</div>
          <input type="number" step="any" placeholder="Monto que entregas" className="w-full rounded border border-rule bg-cloud px-2.5 py-2 text-[12px] font-mono mb-2" value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} />
          <input type="text" placeholder="Descripción (opcional)" className="w-full rounded border border-rule bg-cloud px-2.5 py-2 text-[12px] mb-2" value={fundDesc} onChange={(e) => setFundDesc(e.target.value)} />
          {fundProofUrl ? (
            <div className="flex items-center gap-2 text-[11.5px] text-teal mb-2"><CheckCircle2 size={13} /> Evidencia lista</div>
          ) : (
            <div className="mb-2">{fundUploading ? <div className="text-[11.5px] text-steel">Subiendo…</div> : <UploadBox label="📷 Evidencia de entrega/retiro" onFile={(f) => doUpload(f, "recarga")} />}</div>
          )}
          <button type="button" disabled={busy} className="rounded border border-blue text-blue px-3.5 py-2 text-[12.5px] font-semibold cursor-pointer disabled:opacity-60" onClick={submitFund}>
            Enviar — queda pendiente que confirmen
          </button>
        </div>
      )}
    </div>
  );
}

export function PettyCashPanel({
  principal, secundaria, canManagePrincipal, canManageSecundaria, canFundPrincipal, canFundSecundaria, eligibleOrders,
}: {
  principal: PettyCashBoxDTO | null;
  secundaria: PettyCashBoxDTO | null;
  canManagePrincipal: boolean;
  canManageSecundaria: boolean;
  canFundPrincipal: boolean;
  canFundSecundaria: boolean;
  eligibleOrders: EligiblePaymentOrderDTO[];
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {principal && <BoxCard box={principal} canManage={canManagePrincipal} canFund={canFundPrincipal} showOrderLink={false} eligibleOrders={[]} />}
      {secundaria && <BoxCard box={secundaria} canManage={canManageSecundaria} canFund={canFundSecundaria} showOrderLink={true} eligibleOrders={eligibleOrders} />}
    </div>
  );
}
