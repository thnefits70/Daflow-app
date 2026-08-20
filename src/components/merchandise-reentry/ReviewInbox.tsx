"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Pencil } from "lucide-react";

type ItemDTO = {
  id: string;
  photoUrls: string[];
  catalogItem: { name: string; photos: string[] } | null;
  aiRecognized: boolean;
  declaredName: string | null;
  correctedName: string | null;
  correctedBy: { name: string } | null;
  correctedAt: string | null;
  goodQty: number;
  damagedQty: number;
  damageReason: { name: string } | null;
  damageReasonOther: string | null;
  damageConfirmed: boolean | null;
  approvedAt: string | null;
};

type BatchDTO = {
  id: string;
  code: string;
  createdBy: { name: string } | null;
  submittedAt: string;
  items: ItemDTO[];
};

function itemName(item: ItemDTO) {
  return item.correctedName ?? item.catalogItem?.name ?? item.declaredName ?? "Producto sin nombre";
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

export function ReviewInbox() {
  const [tab, setTab] = useState<"ready" | "review">("ready");
  const [ready, setReady] = useState<BatchDTO[]>([]);
  const [needsReview, setNeedsReview] = useState<BatchDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  function load() {
    fetch("/api/merchandise-reentry/batches/review")
      .then((r) => r.json())
      .then((data) => {
        setReady(data.ready ?? []);
        setNeedsReview(data.needsReview ?? []);
      })
      .catch(() => {
        setReady([]);
        setNeedsReview([]);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function approveBatch(id: string) {
    setBusy(true);
    await postJson(`/api/merchandise-reentry/batches/${id}/approve`).catch(() => null);
    setBusy(false);
    load();
  }

  async function approveAllReady() {
    setBusy(true);
    for (const b of ready) await postJson(`/api/merchandise-reentry/batches/${b.id}/approve`).catch(() => null);
    setBusy(false);
    load();
  }

  if (loading) return <div className="text-[13px] text-steel">Cargando…</div>;

  return (
    <div>
      <div className="flex gap-6 border-b border-rule mb-4">
        <button
          type="button"
          onClick={() => setTab("ready")}
          className={`pb-2.5 text-[13px] font-semibold cursor-pointer border-b-2 flex items-center gap-2 ${tab === "ready" ? "border-teal text-ink" : "border-transparent text-steel"}`}
        >
          Listos para aprobar
          <span className="font-mono text-[10px] font-bold rounded-full px-1.5 py-0.5 bg-green/15 text-green border border-green/40">{ready.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("review")}
          className={`pb-2.5 text-[13px] font-semibold cursor-pointer border-b-2 flex items-center gap-2 ${tab === "review" ? "border-teal text-ink" : "border-transparent text-steel"}`}
        >
          Requiere revisión
          <span className="font-mono text-[10px] font-bold rounded-full px-1.5 py-0.5 bg-red/15 text-red border border-red/40">{needsReview.length}</span>
        </button>
      </div>

      {tab === "ready" && (
        <div className="flex flex-col gap-3">
          {ready.length > 1 && (
            <div className="flex items-center justify-between gap-3 bg-teal/10 border border-teal/30 rounded-md px-4 py-3">
              <div className="text-[12.5px]">
                <b>{ready.length} lotes</b> con todos los productos ya identificados y 100% de unidades buenas.
              </div>
              <button type="button" disabled={busy} className="rounded border border-teal bg-teal px-3.5 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60 whitespace-nowrap" onClick={approveAllReady}>
                Aprobar todos los listos ({ready.length})
              </button>
            </div>
          )}
          {ready.length === 0 && <div className="text-[12.5px] text-steel border-[1.5px] border-dashed border-rule rounded-md p-6 text-center">Nada listo para aprobar por ahora.</div>}
          {ready.map((b) => (
            <div key={b.id} className="bg-surface border border-rule rounded-md overflow-hidden">
              <div className="p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[11px] font-bold text-teal">{b.code}</span>
                    <span className="text-[12px] font-semibold">{b.createdBy?.name ?? "—"}</span>
                    <span className="text-[11px] text-steel">· {fmt(b.submittedAt)}</span>
                  </div>
                  <div className="text-[11.5px] text-steel">{b.items.length} producto(s), todos buenos</div>
                </div>
                <span className="font-mono text-[9.5px] font-bold uppercase rounded-full px-2 py-0.5 bg-green/15 text-green border border-green/40 whitespace-nowrap">Todo identificado</span>
                <button type="button" title="Ver desglose" className="w-8 h-8 rounded border border-rule flex items-center justify-center cursor-pointer text-steel hover:text-teal" onClick={() => setExpandedId(expandedId === b.id ? null : b.id)}>
                  {expandedId === b.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                <button type="button" disabled={busy} className="rounded border border-teal px-3 py-1.5 text-[12px] font-bold text-teal cursor-pointer disabled:opacity-60 whitespace-nowrap" onClick={() => approveBatch(b.id)}>
                  Aprobar lote
                </button>
              </div>
              {expandedId === b.id && (
                <div className="bg-cloud border-t border-rule p-3.5 flex flex-col gap-2">
                  {b.items.map((it) => (
                    <div key={it.id} className="flex items-center gap-2.5">
                      {it.photoUrls[0] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={it.photoUrls[0]}
                          alt={itemName(it)}
                          className="w-9 h-9 object-cover rounded border border-rule cursor-zoom-in"
                          onClick={() => setLightboxUrl(it.photoUrls[0])}
                        />
                      )}
                      <div className="flex-1 text-[12px]">{itemName(it)}</div>
                      <span className="text-[11.5px] text-green font-semibold">{it.goodQty} buenas</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "review" && (
        <div className="flex flex-col gap-3">
          {needsReview.length === 0 && <div className="text-[12.5px] text-steel border-[1.5px] border-dashed border-rule rounded-md p-6 text-center">Nada pendiente de revisión.</div>}
          {needsReview.map((b) => (
            <div key={b.id} className="bg-surface border border-rule rounded-md p-4">
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <span className="font-mono text-[11px] font-bold text-teal">{b.code}</span>
                <span className="text-[12px] font-semibold">{b.createdBy?.name ?? "—"}</span>
                <span className="text-[11px] text-steel">· {fmt(b.submittedAt)}</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {b.items.map((item) => (
                  <ReviewItemRow key={item.id} item={item} onChanged={load} onExpandPhoto={setLightboxUrl} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center cursor-zoom-out p-6"
          onClick={() => setLightboxUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightboxUrl} alt="" className="max-w-[90vw] max-h-[90vh] object-contain rounded-md shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

function ReviewItemRow({ item, onChanged, onExpandPhoto }: { item: ItemDTO; onChanged: () => void; onExpandPhoto: (url: string) => void }) {
  const [name, setName] = useState(item.correctedName ?? item.declaredName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const nameNeedsReview = !item.aiRecognized && !item.correctedName;
  const damageNeedsReview = item.damagedQty > 0 && item.damageConfirmed === null;

  async function saveName() {
    setBusy(true);
    setError("");
    try {
      await postJson(`/api/merchandise-reentry/items/${item.id}/correct-and-approve`, { name });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function resolveDamage(confirmed: boolean) {
    setBusy(true);
    setError("");
    try {
      await postJson(`/api/merchandise-reentry/items/${item.id}/resolve-damage`, { confirmed });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-cloud rounded-md p-3">
      <div className="flex items-center gap-2.5">
        {item.photoUrls[0] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.photoUrls[0]}
            alt={itemName(item)}
            className="w-10 h-10 object-cover rounded border border-rule shrink-0 cursor-zoom-in"
            onClick={() => onExpandPhoto(item.photoUrls[0])}
          />
        )}
        <div className="flex-1 min-w-0">
          {nameNeedsReview ? (
            <div>
              <div className="text-[10.5px] text-steel mb-1">Nombre declarado por el colaborador</div>
              <input className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12.5px]" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          ) : (
            <div className="text-[12.5px] font-semibold truncate">{itemName(item)}</div>
          )}
          {item.correctedName && item.correctedBy && (
            <div className="text-[10px] text-steel mt-1 flex items-center gap-1">
              <Pencil size={10} /> Corregido por {item.correctedBy.name}
              {item.correctedAt && ` · ${fmt(item.correctedAt)}`}
            </div>
          )}
          {item.damagedQty > 0 && (
            <div className="flex items-center gap-1.5 mt-1 text-[11px]">
              <AlertTriangle size={11} className="text-red" />
              <span className="text-red font-semibold">{item.damagedQty} unidades dañadas</span>
              {(item.damageReason?.name || item.damageReasonOther) && (
                <span className="font-mono text-[9.5px] text-steel bg-surface rounded-full px-1.5 py-0.5">{item.damageReason?.name ?? item.damageReasonOther}</span>
              )}
            </div>
          )}
        </div>
        {item.goodQty > 0 && <span className="text-[11.5px] text-green font-semibold shrink-0">{item.goodQty} buenas</span>}

        {nameNeedsReview && !damageNeedsReview && (
          <button type="button" disabled={busy || !name.trim()} className="shrink-0 rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-50" onClick={saveName}>
            Guardar y aprobar
          </button>
        )}
        {damageNeedsReview && (
          <div className="shrink-0 flex gap-1.5">
            <button type="button" disabled={busy} className="rounded border border-rule px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer disabled:opacity-50" onClick={() => resolveDamage(false)}>
              No está dañado
            </button>
            <button type="button" disabled={busy} className="rounded border border-red bg-red px-2.5 py-1.5 text-[11px] font-bold text-white cursor-pointer disabled:opacity-50" onClick={() => resolveDamage(true)}>
              Confirmar daño y dar de baja
            </button>
          </div>
        )}
      </div>
      {nameNeedsReview && damageNeedsReview && (
        <div className="mt-2 pl-[52px]">
          <button type="button" disabled={busy || !name.trim()} className="rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-50" onClick={saveName}>
            Guardar nombre
          </button>
          <div className="text-[10.5px] text-steel mt-1">Resuelve también el daño para poder aprobar este producto.</div>
        </div>
      )}
      {error && <div className="text-red text-[11px] mt-1.5">{error}</div>}
    </div>
  );
}
