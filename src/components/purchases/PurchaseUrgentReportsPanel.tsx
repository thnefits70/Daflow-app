"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Wallet, Upload } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { actorName } from "@/lib/actorName";
import { formatDateTime } from "@/lib/formatDateTime";
import { ProofPreview } from "@/components/shared/ProofPreview";
import { CatalogCode } from "@/components/shared/CatalogCode";

type ResolutionType = "CREDIT" | "REPLACEMENT" | "REFUND" | "WRITE_OFF";
type ResolutionStatus = "PENDING" | "COMPLETED" | "CANCELLED";

type Resolution = {
  id: string;
  type: ResolutionType;
  quantity: number;
  amount: number;
  note: string | null;
  status: ResolutionStatus;
  replacementDueDate: string | null;
  replacementArrivedAt: string | null;
  replacementPhotoUrls: string[];
  replacementAiMatch: boolean | null;
  replacementAiNote: string | null;
  replacementVerifiedBy: { name: string } | null;
  refundProofUrl: string | null;
  refundAiMatch: boolean | null;
  refundAiNote: string | null;
  bankConfirmedAt: string | null;
  credit: { id: string; amount: number; status: "AVAILABLE" | "APPLIED" | "REFUNDED"; proofUrl: string | null; proofName: string | null } | null;
  createdAt: string;
};

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
  request: { quantity: number; unitCost: number; totalCost: number; catalogItem: { name: string; justCode: string | null }; supplier: { id: string; name: string } };
  // Confirmado 2026-08-25: "Reclamo posterior al cierre" — mismo modelo,
  // isLateClaim distingue este camino del "Informar urgente" normal. Ya
  // solo llega acá una vez que Daniel confirmó la baja en Just.
  isLateClaim: boolean;
  lateClaimCode: string | null;
  originUncertain: boolean;
  estimatedUnitCost: number | null;
  stockStatus: "IN_STOCK" | "SOLD" | null;
};

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
function totalReported(r: Report) {
  return r.damagedQty + r.missingQty + r.incompleteQty + r.differentQty;
}

const RESOLUTION_LABEL: Record<ResolutionType, string> = {
  CREDIT: "Crédito futuro",
  REPLACEMENT: "Cambio de mercadería",
  REFUND: "Reembolso",
  WRITE_OFF: "Pérdida (sin acción)",
};

// Confirmado 2026-08-06: bandeja donde Bryan (o admin) coordina con el
// proveedor cada "Informar urgente" que sube Daniel — reparte la cantidad
// afectada entre uno o varios caminos (crédito/cambio/reembolso/pérdida),
// nunca escribe un monto a mano (siempre cantidad × costo real de la
// cotización). El reembolso lo confirma admin en su banco; el resto de
// pasos son de Bryan.
export function PurchaseUrgentReportsPanel({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [reports, setReports] = useState<Report[] | null>(null);
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const [resType, setResType] = useState<ResolutionType>("CREDIT");
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

  const [refundUploadingFor, setRefundUploadingFor] = useState<string | null>(null);
  const [confirmBankId, setConfirmBankId] = useState<string | null>(null);

  function load() {
    fetch("/api/purchase-requests/urgent-reports").then((r) => (r.ok ? r.json() : [])).then(setReports).catch(() => setReports([]));
  }
  useEffect(load, []);

  function openResolutionForm(reportId: string) {
    setOpenReportId(reportId);
    setResType("CREDIT");
    setResQty("");
    setResDueDate("");
    setResNote("");
    setResProofUrl("");
    setResProofName("");
    setErr("");
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
  }

  async function submitResolution(reportId: string) {
    const qty = Number(resQty);
    if (!qty || qty <= 0) { setErr("Ingresa una cantidad válida."); return; }
    if (resType === "REPLACEMENT" && !resDueDate) { setErr("Elige la fecha máxima del cambio."); return; }
    if (resType === "WRITE_OFF" && !resNote.trim()) { setErr("Explica por qué no se recupera."); return; }
    if (resType === "CREDIT" && !resProofUrl) { setErr("Sube el comprobante del proveedor."); return; }
    setBusy(true);
    setErr("");
    const body: Record<string, unknown> = { type: resType, quantity: qty };
    if (resType === "REPLACEMENT") body.dueDate = resDueDate;
    if (resType === "WRITE_OFF") body.note = resNote.trim();
    if (resType === "CREDIT") { body.proofUrl = resProofUrl; body.proofName = resProofName; }
    const res = await fetch(`/api/purchase-requests/urgent-reports/${reportId}/resolutions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo registrar."); return; }
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

  if (!reports) return <div className="text-steel text-[13px]">Cargando…</div>;

  const openReports = reports.filter((r) => claimedQty(r.resolutions) < totalReported(r));
  const closedReports = reports.filter((r) => claimedQty(r.resolutions) >= totalReported(r));
  const pendingCredits = reports.flatMap((r) => r.resolutions.filter((res) => res.credit?.status === "AVAILABLE").map((res) => ({ report: r, res })));

  return (
    <div className="flex flex-col gap-4">
      {pendingCredits.length > 0 && (
        <div className="bg-surface border border-gold/40 rounded-md p-4">
          <div className="flex items-center gap-1.5 text-[12px] font-bold mb-2" style={{ color: "#D9A441" }}>
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
                    {r.request.supplier.name} — pagado {money(r.request.totalCost)} · {r.request.quantity} un. pedidas
                  </div>
                  {r.isLateClaim && r.originUncertain && (
                    <div className="flex items-center gap-1.5 text-[11px] mb-1" style={{ color: "#D9A441" }}>
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
                    ${(totalReported(r) * claimUnitCost(r)).toFixed(2)} en disputa
                  </div>
                  <div className="text-[12px] mb-2">{r.description}</div>

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
                        <ResolutionRow key={res.id} res={res} isAdmin={isAdmin} refundUploadingFor={refundUploadingFor} confirmBankId={confirmBankId} setConfirmBankId={setConfirmBankId} onFileRefund={(f) => uploadRefundProof(res.id, f)} onConfirmBank={() => confirmBank(res.id)} busy={busy} />
                      ))}
                    </div>
                  )}

                  {openReportId === r.id ? (
                    <div className="bg-cloud rounded-md p-3">
                      <div className="flex gap-1.5 mb-2.5 flex-wrap">
                        {(["CREDIT", "REPLACEMENT", "REFUND", "WRITE_OFF"] as const).map((t) => (
                          <button key={t} type="button" className={`rounded border px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer ${resType === t ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`} onClick={() => setResType(t)}>
                            {RESOLUTION_LABEL[t]}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                        <div>
                          <label className="block mb-1 text-[10px] text-steel">Cantidad (máx. {remaining})</label>
                          <input type="number" min={1} max={remaining} className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={resQty} onChange={(e) => setResQty(e.target.value)} />
                        </div>
                        {resType === "REPLACEMENT" && (
                          <div>
                            <label className="block mb-1 text-[10px] text-steel">Fecha máxima del cambio</label>
                            <input type="date" className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={resDueDate} onChange={(e) => setResDueDate(e.target.value)} />
                          </div>
                        )}
                      </div>
                      {resType === "WRITE_OFF" && (
                        <textarea className="w-full rounded border border-rule px-2.5 py-2 text-[12.5px] mb-2.5" rows={2} placeholder="¿Por qué no se recupera?" value={resNote} onChange={(e) => setResNote(e.target.value)} />
                      )}
                      {resType === "CREDIT" && (
                        <div className="mb-2.5">
                          <label className="block mb-1 text-[10px] text-steel">Comprobante del proveedor (chat, correo, nota de crédito)</label>
                          {!resProofUrl ? (
                            <label className="flex items-center gap-1.5 border-[1.5px] border-dashed border-rule rounded px-2.5 py-1.5 text-[11px] text-steel cursor-pointer hover:border-teal w-fit">
                              {resProofUploading ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={12} />}
                              Subir comprobante
                              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadCreditProof(e.target.files[0])} />
                            </label>
                          ) : (
                            <div className="flex items-center gap-2">
                              <ProofPreview url={resProofUrl} size={36} filename={resProofName || "comprobante-credito"} />
                              <label className="text-steel underline cursor-pointer text-[11px]">
                                cambiar
                                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadCreditProof(e.target.files[0])} />
                              </label>
                            </div>
                          )}
                        </div>
                      )}
                      {resQty && Number(resQty) > 0 && (
                        <div className="text-[12px] font-semibold mb-2.5">Monto: {money(Number(resQty) * claimUnitCost(r))}</div>
                      )}
                      {err && <div className="text-red text-[12px] mb-2">{err}</div>}
                      <div className="flex items-center gap-2">
                        <button type="button" disabled={busy || resProofUploading} className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => submitResolution(r.id)}>
                          Registrar
                        </button>
                        <button type="button" className="text-steel text-[12px] cursor-pointer" onClick={() => setOpenReportId(null)}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12px] font-semibold text-white cursor-pointer" onClick={() => openResolutionForm(r.id)}>
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
                    <div key={res.id} className="text-steel">{RESOLUTION_LABEL[res.type]} — {res.quantity} un. · {money(res.amount)}</div>
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
  res, isAdmin, refundUploadingFor, confirmBankId, setConfirmBankId, onFileRefund, onConfirmBank, busy,
}: {
  res: Resolution;
  isAdmin: boolean;
  refundUploadingFor: string | null;
  confirmBankId: string | null;
  setConfirmBankId: (id: string | null) => void;
  onFileRefund: (file: File) => void;
  onConfirmBank: () => void;
  busy: boolean;
}) {
  return (
    <div className="bg-cloud rounded px-3 py-2 text-[11.5px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{RESOLUTION_LABEL[res.type]} — {res.quantity} un. · {money(res.amount)}</span>
        <span className={`text-[10px] font-bold uppercase ${res.status === "COMPLETED" ? "text-green" : "text-steel"}`}>{res.status === "COMPLETED" ? "Listo" : "En curso"}</span>
      </div>

      {res.type === "CREDIT" && res.credit && (
        <div className="mt-0.5">
          <div className="text-steel">{res.credit.status === "AVAILABLE" ? "Disponible para la próxima compra a este proveedor" : res.credit.status === "APPLIED" ? "Ya aplicado a una compra" : "Reembolsado"}</div>
          {res.credit.proofUrl && (
            <div className="mt-1.5"><ProofPreview url={res.credit.proofUrl} size={36} filename={res.credit.proofName ?? "comprobante-credito"} /></div>
          )}
        </div>
      )}

      {res.type === "WRITE_OFF" && res.note && <div className="text-steel mt-0.5">{res.note}</div>}

      {res.type === "REPLACEMENT" && (
        <div className="text-steel mt-0.5">
          {res.status === "COMPLETED" ? (
            <>Verificado por {actorName(res.replacementVerifiedBy?.name)}{res.replacementArrivedAt ? ` · ${formatDateTime(res.replacementArrivedAt)}` : ""}{res.replacementAiNote ? ` — 🤖 ${res.replacementAiNote}` : ""}</>
          ) : (
            <>Esperando el cambio — vence {res.replacementDueDate ? new Date(res.replacementDueDate).toLocaleDateString("es-MX") : "—"}</>
          )}
        </div>
      )}

      {res.type === "REFUND" && (
        <div className="mt-1.5">
          {!res.refundProofUrl ? (
            <label className="flex items-center gap-1.5 border-[1.5px] border-dashed border-rule rounded px-2.5 py-1.5 text-[11px] text-steel cursor-pointer hover:border-teal w-fit">
              {refundUploadingFor === res.id ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={12} />}
              Subir comprobante del proveedor
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFileRefund(e.target.files[0])} />
            </label>
          ) : (
            <div>
              <div className="mb-1"><ProofPreview url={res.refundProofUrl} size={40} filename="comprobante-reembolso" /></div>
              <div className={`flex items-center gap-1.5 ${res.refundAiMatch ? "text-teal" : "text-red"}`}>
                {res.refundAiMatch ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} 🤖 {res.refundAiNote}
                {!res.refundAiMatch && (
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
              <div className="bg-surface border border-gold/40 rounded-md p-2.5 mt-2" style={{ color: "#D9A441" }}>
                <div className="text-[11.5px] font-semibold mb-1.5">¿Confirmas que revisaste tu cuenta bancaria y sí llegó {money(res.amount)}?</div>
                <div className="text-[11px] text-steel mb-2">Desde que confirmes, este reembolso queda bajo tu responsabilidad.</div>
                <div className="flex items-center gap-2">
                  <button type="button" disabled={busy} className="rounded border border-green bg-green px-3 py-1.5 text-[11.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={onConfirmBank}>Sí, confirmo que llegó</button>
                  <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => setConfirmBankId(null)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <button type="button" className="rounded border border-gold/50 px-2.5 py-1.5 text-[11px] font-semibold mt-1.5 cursor-pointer" style={{ color: "#D9A441" }} onClick={() => setConfirmBankId(res.id)}>
                Confirmar que llegó el dinero
              </button>
            )
          )}
          {res.status === "COMPLETED" && <div className="text-green mt-1 flex items-center gap-1"><CheckCircle2 size={12} /> Confirmado el {res.bankConfirmedAt ? formatDateTime(res.bankConfirmedAt) : ""}</div>}
        </div>
      )}
    </div>
  );
}
