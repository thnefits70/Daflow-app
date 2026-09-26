"use client";

import { useMemo, useState } from "react";
import { X, Sparkles, AlertTriangle, CheckCircle2, Brain } from "lucide-react";
import { compressImage } from "@/lib/compressImage";
import { uploadFile } from "@/lib/uploadFile";
import { computeCreditProofWarnings, type CreditDuplicateWarning, type CreditProofClaim, type CreditProofRead } from "@/lib/supplierCreditProofShared";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

type ReadResponse = { read: CreditProofRead; signature: string; duplicates: CreditDuplicateWarning[]; claims: CreditProofClaim[] };

// Confirmado 2026-09-23, pedido explícito del usuario (Jariel con Zheng wu):
// un solo comprobante del proveedor → la IA lo lee una vez, marca sola los
// reclamos que menciona (lo memorizado por código manda), y Jariel revisa y
// confirma UN crédito por todos. Si algo no cuadra, puede seguir pero tiene
// que explicar la diferencia (se le avisa a admin).
export function SupplierCreditProofDialog({
  supplier,
  claims: initialClaims,
  preselectedIds,
  onClose,
  onDone,
}: {
  supplier: { id: string; name: string };
  claims: CreditProofClaim[];
  preselectedIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofName, setProofName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reading, setReading] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [data, setData] = useState<ReadResponse | null>(null);
  const [claims, setClaims] = useState<CreditProofClaim[]>(initialClaims);
  const [selected, setSelected] = useState<Set<string>>(new Set(preselectedIds));
  // Correcciones a mano: renglón del comprobante → reclamo (null = ninguno).
  const [lineOverrides, setLineOverrides] = useState<Record<number, string | null>>({});
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function onFile(file: File) {
    setError("");
    setUploading(true);
    const compressed = file.type === "application/pdf" ? file : await compressImage(file);
    const up = await uploadFile(compressed, "merchandise-outflow-photos");
    setUploading(false);
    if (!up.ok) {
      setError(up.error);
      return;
    }
    setProofUrl(up.url);
    setProofName(file.name);
    setReading(true);
    setReadFailed(false);
    try {
      const res = await fetch("/api/merchandise-outflow/purchase-credit/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId: supplier.id, proofUrl: up.url }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "La IA no pudo leer el comprobante.");
      const r = json as ReadResponse;
      setData(r);
      setClaims(r.claims);
      // Marca sola lo que el comprobante menciona, sin quitar lo que Jariel ya había elegido.
      setSelected((prev) => new Set([...prev, ...r.read.lines.map((l) => l.claimId).filter((x): x is string => !!x)]));
      const suggested = r.read.total ?? r.read.lines.reduce((s, l) => s + (l.amount ?? 0), 0);
      if (suggested > 0) setAmount(suggested.toFixed(2));
    } catch (e) {
      setReadFailed(true);
      setError(e instanceof Error ? e.message : "La IA no pudo leer el comprobante.");
    } finally {
      setReading(false);
    }
  }

  // Lectura con las correcciones de Jariel aplicadas (mismo cálculo que hace el servidor).
  const effectiveRead = useMemo<CreditProofRead | null>(() => {
    if (!data) return null;
    const lines = data.read.lines.map((l) => ({ ...l }));
    for (const [idx, itemId] of Object.entries(lineOverrides)) {
      const line = lines[Number(idx)];
      if (!line) continue;
      line.claimId = itemId;
    }
    return { ...data.read, lines };
  }, [data, lineOverrides]);

  const selectedClaims = claims.filter((c) => selected.has(c.id));
  const numericAmount = Number(amount);
  const expectedSum = selectedClaims.reduce((s, c) => s + (c.expectedCredit ?? 0), 0);
  const canCheck = !!proofUrl && !reading && (!!data || readFailed);
  const warnings = canCheck && numericAmount > 0
    ? computeCreditProofWarnings({ read: effectiveRead, supplierName: supplier.name, selectedClaims, amount: numericAmount, duplicates: data?.duplicates ?? [] })
    : [];
  const toRemember = (effectiveRead?.lines ?? []).filter((l) => l.code && l.claimId && selected.has(l.claimId) && l.matchedBy !== "memoria");

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/merchandise-outflow/purchase-credit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: supplier.id,
          itemIds: [...selected],
          amount: numericAmount,
          proofUrl,
          proofName: proofName ?? undefined,
          read: data?.read ?? null,
          signature: data?.signature ?? null,
          lineLinks: Object.entries(lineOverrides).map(([lineIndex, itemId]) => ({ lineIndex: Number(lineIndex), itemId })),
          note: note.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "No se pudo registrar el crédito.");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar el crédito.");
    } finally {
      setSaving(false);
    }
  }

  const claimName = (id: string | null) => claims.find((c) => c.id === id)?.name ?? "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-surface border border-rule rounded-lg p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[14px] font-bold">Crédito de {supplier.name}</div>
          <button type="button" aria-label="Cerrar" className="text-steel cursor-pointer" onClick={onClose}><X size={16} /></button>
        </div>

        {!proofUrl ? (
          <label className="block rounded-md border border-dashed border-rule p-4 text-center cursor-pointer hover:bg-cloud">
            <div className="text-[12.5px] font-semibold text-blue">{uploading ? "Subiendo…" : "Subir comprobante del proveedor"}</div>
            <div className="text-[11px] text-steel mt-0.5">Captura del chat o documento donde acepta el crédito. La IA lo lee y marca sola los productos.</div>
            <input type="file" accept="image/*,application/pdf" className="hidden" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
          </label>
        ) : reading ? (
          <div className="flex items-center gap-2 text-[12.5px] text-steel p-3"><Sparkles size={14} className="text-blue animate-pulse" /> Leyendo el comprobante…</div>
        ) : (
          <>
            {data && (
              <div className="bg-cloud rounded-md p-2.5 mb-3 text-[11.5px]">
                <div className="font-semibold mb-1 flex items-center gap-1.5"><Sparkles size={12} className="text-blue" /> Lo que leyó la IA</div>
                <div className="text-steel">
                  Proveedor: {data.read.supplierNameOnDoc ?? "no se ve"}
                  {data.read.supplierMatches === "si" && <span className="text-green font-semibold"> ✓</span>}
                  {data.read.supplierMatches === "no" && <span className="text-red font-semibold"> — no parece {supplier.name}</span>}
                  {data.read.docDate && <> · Fecha: {data.read.docDate}</>}
                  {" · "}Total: {data.read.total != null ? <span className="font-semibold text-ink">{money(data.read.total)}</span> : "no aparece"}
                </div>
                {effectiveRead && effectiveRead.lines.length > 0 && (
                  <div className="flex flex-col gap-1 mt-2">
                    {effectiveRead.lines.map((l, idx) => (
                      <div key={idx} className="flex items-center gap-2 bg-surface rounded px-2 py-1.5">
                        <div className="flex-1 min-w-0">
                          <div className="truncate">
                            {l.code && <span className="font-mono font-semibold mr-1">{l.code}</span>}
                            {l.description}
                          </div>
                          <div className="text-steel text-[10.5px]">
                            {l.quantity != null && <>{l.quantity} un. · </>}
                            {l.amount != null ? money(l.amount) : "sin monto"}
                            {l.matchedBy === "memoria" && lineOverrides[idx] === undefined && <span className="ml-1 text-teal inline-flex items-center gap-0.5"><Brain size={10} /> ya conocido</span>}
                          </div>
                        </div>
                        <select
                          className="shrink-0 max-w-[45%] rounded border border-rule bg-surface px-1.5 py-1 text-[11px]"
                          value={l.claimId ?? ""}
                          onChange={(e) => {
                            const v = e.target.value || null;
                            setLineOverrides((prev) => ({ ...prev, [idx]: v }));
                            if (v) setSelected((prev) => new Set([...prev, v]));
                          }}
                        >
                          <option value="">— ¿Qué producto es? —</option>
                          {claims.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
                {data.read.notes && <div className="text-steel mt-1.5 italic">{data.read.notes}</div>}
              </div>
            )}

            <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-1.5">Reclamos que cubre este crédito</div>
            <div className="flex flex-col gap-1 mb-3">
              {claims.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded border border-rule px-2.5 py-2 text-[12px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={(e) => setSelected((prev) => { const n = new Set(prev); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })}
                  />
                  <span className="flex-1 min-w-0 truncate">{c.name} · {c.quantity} un.</span>
                  {c.expectedCredit != null && <span className="text-steel shrink-0">estimado {money(c.expectedCredit)}</span>}
                </label>
              ))}
            </div>

            <div className="flex items-center gap-2 mb-1">
              <input type="number" min={0} step="0.01" placeholder="Monto del crédito" className="flex-1 rounded border border-rule bg-surface px-2.5 py-1.5 text-[12.5px]" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="text-[10.5px] text-steel mb-3">Suma estimada de lo marcado: {money(expectedSum)}</div>

            {toRemember.length > 0 && (
              <div className="text-[11px] text-teal mb-2 flex items-start gap-1.5">
                <Brain size={12} className="mt-0.5 shrink-0" />
                <span>Se recordará para {supplier.name}: {toRemember.map((l) => `${l.code} = ${claimName(l.claimId)}`).join(" · ")}</span>
              </div>
            )}

            {canCheck && numericAmount > 0 && selectedClaims.length > 0 && (
              warnings.length === 0 ? (
                <div className="flex items-center gap-1.5 text-[12px] text-green font-semibold mb-2"><CheckCircle2 size={13} /> Todo cuadra.</div>
              ) : (
                <div className="bg-gold/10 border border-gold/40 rounded-md p-2.5 mb-2 text-[11.5px]">
                  <div className="flex items-center gap-1.5 font-semibold mb-1" style={{ color: "var(--color-gold)" }}><AlertTriangle size={12} /> Algo no cuadra</div>
                  <ul className="list-disc pl-4 flex flex-col gap-0.5">
                    {warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                  <textarea
                    className="w-full mt-2 rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px]"
                    rows={2}
                    placeholder="Explica la diferencia (se le avisa a admin)…"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              )
            )}
          </>
        )}

        {error && <div className="text-red text-[11.5px] my-1.5">{error}</div>}

        {proofUrl && !reading && (
          <div className="flex gap-2 mt-2">
            <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={onClose}>Cancelar</button>
            <button
              type="button"
              disabled={saving || !canCheck || selectedClaims.length === 0 || !(numericAmount > 0) || (warnings.length > 0 && !note.trim())}
              className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40"
              onClick={submit}
            >
              {saving ? "Guardando…" : `Confirmar crédito${selectedClaims.length > 1 ? ` (${selectedClaims.length} reclamos)` : ""}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
