"use client";

import { useEffect, useState } from "react";
import { Search, PackageCheck, DollarSign, XCircle, AlertTriangle } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { formatDateTime } from "@/lib/formatDateTime";
import { compressImage } from "@/lib/compressImage";
import { uploadFile } from "@/lib/uploadFile";

type SupplierOption = { id: string; name: string };
type ItemDTO = {
  id: string;
  declaredName: string;
  quantity: number;
  catalogItem: { name: string; photos: string[]; justCode: string | null } | null;
  damageReason: { name: string } | null;
  damageReasonOther: string | null;
  batch: { code: string };
  purchaseGestionSupplier: SupplierOption | null;
  linkedPurchaseRequest: { requestNumber: number | null; requestedAt: string; quantity: number; unitCost: number } | null;
  unitCostAtExchange: number | null;
  expectedCreditAmount: number | null;
  purchaseExceptionDecision: "DATA_CORRECTED" | "AUTHORIZED" | "REJECTED" | null;
  purchaseExceptionNote: string | null;
};

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

function itemName(item: ItemDTO) {
  return item.catalogItem?.name ?? item.declaredName;
}

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Confirmado 2026-09-17, pedido explícito del usuario: quien gestiona
// compras (hoy Jariel) elige el proveedor A MANO para cada reclamo de
// deterioro escalado — nunca se ancla solo, para no acusar a un proveedor
// que no vendió esa mercadería (ver purchase-link/route.ts, que busca la
// última compra REAL a ese proveedor de ese producto). Si no hay ninguna
// compra que lo respalde, no se puede cerrar el caso — pasa como excepción
// a admin (purchase-no-match/route.ts).
export function PurchaseDeteriorGestionPanel() {
  const [items, setItems] = useState<ItemDTO[] | null>(null);

  function load() {
    fetch("/api/merchandise-outflow/purchase-gestion")
      .then((r) => r.json())
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]));
  }
  useEffect(load, []);

  if (items === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (items.length === 0) return <div className="text-[13px] text-steel">No hay reclamos de deterioro pendientes de gestionar.</div>;

  return (
    <div className="flex flex-col gap-3 max-w-lg">
      {items.map((item) => (
        <GestionCard key={item.id} item={item} onChanged={load} />
      ))}
    </div>
  );
}

function GestionCard({ item, onChanged }: { item: ItemDTO; onChanged: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SupplierOption[]>([]);
  const [linking, setLinking] = useState(false);
  const [pickingAgain, setPickingAgain] = useState(false);
  const [error, setError] = useState("");
  const [resolving, setResolving] = useState<"REPLACED" | "CREDIT_ISSUED" | "REJECTED" | null>(null);
  const [reportingNoMatch, setReportingNoMatch] = useState(false);
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item.purchaseGestionSupplier && !pickingAgain) return;
    const t = setTimeout(() => {
      fetch(`/api/merchandise-outflow/supplier-search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => (r.ok ? r.json() : []))
        .then(setResults)
        .catch(() => null);
    }, 200);
    return () => clearTimeout(t);
  }, [query, item.purchaseGestionSupplier, pickingAgain]);

  async function linkSupplier(supplier: SupplierOption) {
    setLinking(true);
    setError("");
    try {
      await postJson(`/api/merchandise-outflow/items/${item.id}/purchase-link`, { supplierId: supplier.id });
      setPickingAgain(false);
      setQuery("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo vincular el proveedor.");
    } finally {
      setLinking(false);
    }
  }

  async function submitNoMatch() {
    if (!note.trim()) return;
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/merchandise-outflow/items/${item.id}/purchase-no-match`, { note: note.trim() });
      setReportingNoMatch(false);
      setNote("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reportar.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadProofFile(file: File) {
    setUploadingProof(true);
    setError("");
    const compressed = await compressImage(file);
    const result = await uploadFile(compressed, "merchandise-outflow-photos");
    setUploadingProof(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setProofUrl(result.url);
  }

  async function submitResolve() {
    if (!resolving) return;
    setSaving(true);
    setError("");
    try {
      const body =
        resolving === "CREDIT_ISSUED"
          ? { resolution: "CREDIT_ISSUED", amount: Number(amount), proofUrl, note: note.trim() || undefined }
          : { resolution: resolving, note: note.trim() || undefined };
      await postJson(`/api/merchandise-outflow/items/${item.id}/purchase-resolve`, body);
      setResolving(null);
      setNote("");
      setAmount("");
      setProofUrl(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar.");
    } finally {
      setSaving(false);
    }
  }

  const isAnchored = !!item.linkedPurchaseRequest;
  const isAuthorizedException = item.purchaseExceptionDecision === "AUTHORIZED";
  const canResolve = isAnchored || isAuthorizedException;

  return (
    <div className="bg-surface border border-rule rounded-md p-3.5">
      <div className="flex items-center gap-3 mb-2.5">
        {item.catalogItem?.photos[0] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.catalogItem.photos[0]} alt={itemName(item)} className="w-12 h-12 object-cover rounded border border-rule shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold flex items-center gap-1.5 min-w-0">
            {item.catalogItem && <CatalogCode code={item.catalogItem.justCode} />}
            <span className="truncate">{itemName(item)}</span>
          </div>
          <div className="text-[11px] text-steel">{item.quantity} un. · {item.damageReason?.name ?? item.damageReasonOther ?? "Sin motivo"} · {item.batch.code}</div>
        </div>
      </div>

      {isAuthorizedException && !isAnchored && (
        <div className="bg-blue/10 border border-blue/40 rounded-md p-2.5 mb-2.5 text-[11.5px]">
          <span className="font-semibold text-blue">Admin autorizó seguir sin compra vinculada.</span> {item.purchaseExceptionNote}
        </div>
      )}

      {(!item.purchaseGestionSupplier || pickingAgain) && !canResolve && (
        <div className="bg-cloud rounded-md p-2.5 mb-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-1.5">Elige el proveedor</div>
          <div className="flex items-center gap-1.5 rounded border border-rule bg-surface px-2.5 py-2">
            <Search size={13} className="text-steel" />
            <input type="text" placeholder="Buscá el proveedor…" className="flex-1 text-[12.5px] outline-none bg-transparent" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {results.length > 0 && (
            <div className="flex flex-col gap-1 mt-1.5 border border-rule rounded-md overflow-hidden">
              {results.map((s) => (
                <button key={s.id} type="button" disabled={linking} className="text-left p-2 text-[12.5px] font-medium hover:bg-surface cursor-pointer disabled:opacity-50" onClick={() => linkSupplier(s)}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {item.purchaseGestionSupplier && !pickingAgain && !isAnchored && !isAuthorizedException && (
        <div className="bg-red/10 border border-red/40 rounded-md p-2.5 mb-2.5 text-[11.5px]">
          <div className="flex items-center gap-1.5 font-semibold text-red mb-1">
            <AlertTriangle size={13} /> No hay ninguna compra registrada a {item.purchaseGestionSupplier.name} de este producto.
          </div>
          {!reportingNoMatch ? (
            <div className="flex gap-2 mt-1.5">
              <button type="button" className="text-[11.5px] font-semibold text-blue cursor-pointer" onClick={() => setPickingAgain(true)}>
                Probar otro proveedor
              </button>
              <button type="button" className="text-[11.5px] font-semibold text-red cursor-pointer" onClick={() => setReportingNoMatch(true)}>
                Reportar sin respaldo
              </button>
            </div>
          ) : (
            <div className="mt-1.5">
              <textarea
                className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px] mb-2"
                rows={2}
                placeholder="¿Qué proveedores probaste? ¿Por qué crees que fue este?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="flex gap-2">
                <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => setReportingNoMatch(false)}>Cancelar</button>
                <button type="button" disabled={saving || !note.trim()} className="flex-1 rounded border border-red bg-red px-2.5 py-1.5 text-[11.5px] font-bold text-white cursor-pointer disabled:opacity-40" onClick={submitNoMatch}>
                  {saving ? "Enviando…" : "Enviar a admin"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {(item.purchaseGestionSupplier && (isAnchored || isAuthorizedException)) && (
        <div className="mb-2.5">
          <div className="text-[11.5px] mb-1">
            Proveedor: <span className="font-semibold">{item.purchaseGestionSupplier.name}</span>
          </div>
          {item.linkedPurchaseRequest && (
            <div className="text-[11px] text-steel">
              Última compra: {formatDateTime(item.linkedPurchaseRequest.requestedAt)} · {money(item.unitCostAtExchange ?? 0)}/un. · crédito estimado{" "}
              <span className="font-semibold text-blue">{money(item.expectedCreditAmount ?? 0)}</span>
            </div>
          )}
        </div>
      )}

      {error && <div className="text-red text-[11.5px] mb-1.5">{error}</div>}

      {canResolve && !resolving && (
        <div className="flex gap-1.5 flex-wrap">
          <button type="button" className="flex items-center gap-1 text-[11.5px] font-semibold border border-green/40 text-green rounded-full px-2.5 py-1 cursor-pointer" onClick={() => setResolving("REPLACED")}>
            <PackageCheck size={12} /> Mandó reemplazo
          </button>
          <button type="button" className="flex items-center gap-1 text-[11.5px] font-semibold border border-blue/40 text-blue rounded-full px-2.5 py-1 cursor-pointer" onClick={() => setResolving("CREDIT_ISSUED")}>
            <DollarSign size={12} /> Dio crédito
          </button>
          <button type="button" className="flex items-center gap-1 text-[11.5px] font-semibold border border-red/40 text-red rounded-full px-2.5 py-1 cursor-pointer" onClick={() => setResolving("REJECTED")}>
            <XCircle size={12} /> Rechazó el reclamo
          </button>
        </div>
      )}

      {resolving && (
        <div className="bg-cloud rounded-md p-2.5">
          <div className="text-[12px] font-semibold mb-1.5">
            {resolving === "REPLACED" ? "¿Confirmar que el proveedor mandó reemplazo?" : resolving === "CREDIT_ISSUED" ? "Registrar el crédito que dio el proveedor" : "Explica qué te dijo el proveedor"}
          </div>
          {resolving === "CREDIT_ISSUED" && (
            <>
              <input type="number" min={0} step="0.01" placeholder="Monto del crédito" className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12.5px] mb-2" value={amount} onChange={(e) => setAmount(e.target.value)} />
              {proofUrl ? (
                <div className="text-[11.5px] text-green font-semibold mb-2">Comprobante subido.</div>
              ) : (
                <label className="block mb-2 text-[11.5px] font-semibold text-blue cursor-pointer">
                  {uploadingProof ? "Subiendo…" : "Subir comprobante (captura del chat/documento)"}
                  <input type="file" accept="image/*" className="hidden" disabled={uploadingProof} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadProofFile(f); e.target.value = ""; }} />
                </label>
              )}
            </>
          )}
          {resolving !== "REPLACED" && (
            <textarea className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px] mb-2" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota…" />
          )}
          <div className="flex gap-2">
            <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => { setResolving(null); setNote(""); setAmount(""); setProofUrl(null); setError(""); }}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving || (resolving === "CREDIT_ISSUED" && (!Number(amount) || !proofUrl)) || (resolving === "REJECTED" && !note.trim())}
              className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40"
              onClick={submitResolve}
            >
              {saving ? "Guardando…" : "Confirmar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
