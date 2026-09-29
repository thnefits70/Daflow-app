"use client";

import { useEffect, useState, type ReactNode } from "react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { formatDateTime } from "@/lib/formatDateTime";
import { ProofPreview } from "@/components/shared/ProofPreview";

type Eligible = {
  id: string;
  code: string | null;
  productName: string;
  supplierName: string;
  quantity: number;
  unitCost: number;
  status: string;
  requestedAt: string;
};

type Correction = {
  id: string;
  code: string | null;
  productName: string;
  supplierName: string;
  quantity: number;
  oldUnitCost: number;
  newUnitCost: number;
  reason: string;
  proofUrl: string;
  proofName: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectReason: string | null;
  requestedByName: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  kardexAdjustedUnits: number | null;
  inKardex: boolean;
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

const STATUS_LABEL: Record<string, string> = {
  APPROVED: "Aprobada",
  RECEIVED_PENDING_REVIEW: "Recibida, falta Daniel",
  RECEIVED: "Recibida",
};

// Confirmado 2026-09-29, pedido del usuario (caso pistola de pintura: Bryan
// negoció $10 con CHEN, la solicitud decía $10.50): Jariel o Bryan piden
// corregir el precio de una compra ya aprobada que todavía no se pagó, con
// la captura del acuerdo; solo el admin aprueba. Al aprobar se actualiza
// solo la solicitud, la deuda/hoja de CHEN y el Kardex (INVESTOCK).
export function PurchasePriceCorrectionPanel() {
  const [data, setData] = useState<{ corrections: Correction[]; eligible: Eligible[]; isAdmin: boolean } | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newPrice, setNewPrice] = useState("");
  const [reason, setReason] = useState("");
  const [proof, setProof] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  function load() {
    fetch("/api/purchase-price-corrections")
      .then((r) => (r.ok ? r.json() : { corrections: [], eligible: [], isAdmin: false }))
      .then(setData);
  }
  useEffect(load, []);

  const selected = data?.eligible.find((e) => e.id === selectedId) ?? null;
  const parsedPrice = Number(newPrice.replace(",", "."));
  const priceOk = newPrice.trim() !== "" && Number.isFinite(parsedPrice) && parsedPrice > 0;

  async function uploadProof(file: File) {
    setUploading(true);
    setErr("");
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-price-corrections");
    setUploading(false);
    if (!uploaded.ok) { setErr(uploaded.error); return; }
    setProof({ url: uploaded.url, name: file.name });
  }

  async function submit() {
    if (!selected) return;
    if (!priceOk) { setErr("Escribe el precio nuevo por unidad."); return; }
    if (!reason.trim()) { setErr("Explica qué se negoció con el proveedor."); return; }
    if (!proof) { setErr("Sube la captura del acuerdo con el proveedor."); return; }
    setBusy(true);
    setErr("");
    const res = await fetch("/api/purchase-price-corrections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: selected.id, newUnitCost: parsedPrice, reason: reason.trim(), proofUrl: proof.url, proofName: proof.name }),
    });
    setBusy(false);
    if (!res.ok) { setErr((await res.json().catch(() => null))?.error ?? "No se pudo enviar."); return; }
    setMsg(data?.isAdmin ? "Registrada — apruébala abajo." : "Enviada al admin. Mientras decide, esta compra no se puede pagar.");
    setSelectedId(null);
    setNewPrice("");
    setReason("");
    setProof(null);
    setSearch("");
    load();
  }

  async function review(id: string, action: "approve" | "reject") {
    if (action === "reject" && !rejectReason.trim()) return;
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/purchase-price-corrections/${id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, rejectReason: rejectReason.trim() || undefined }),
    });
    setBusy(false);
    if (!res.ok) { setErr((await res.json().catch(() => null))?.error ?? "No se pudo guardar."); return; }
    setRejectingId(null);
    setRejectReason("");
    load();
  }

  if (!data) return <div className="text-steel text-[13px]">Cargando…</div>;

  const q = search.trim().toLowerCase();
  const matches = q
    ? data.eligible.filter((e) => `${e.code ?? ""} ${e.productName} ${e.supplierName}`.toLowerCase().includes(q)).slice(0, 8)
    : data.eligible.slice(0, 8);
  const pending = data.corrections.filter((c) => c.status === "PENDING");
  const history = data.corrections.filter((c) => c.status !== "PENDING");

  return (
    <div className="flex flex-col gap-6">
      {err && <div className="text-[12.5px] text-red">{err}</div>}

      {/* Pedir una corrección */}
      <div className="bg-surface border border-rule rounded-md p-4">
        <div className="font-display font-bold text-[14px] mb-1">Pedir corrección de precio</div>
        <div className="text-[12px] text-steel mb-3">
          Solo compras aprobadas que todavía no se pagaron. El admin la aprueba; al aprobar se corrige solo la deuda, la hoja del proveedor y el Kardex.
        </div>
        {msg && <div className="text-[12.5px] text-green mb-2">{msg}</div>}

        {!selected ? (
          <>
            <input
              className="text-[13px] rounded border border-rule bg-cloud px-2.5 py-2 w-full mb-2"
              placeholder="Buscar por producto, proveedor o SC-…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setMsg(""); }}
            />
            {matches.length === 0 && <div className="text-[12.5px] text-steel">No hay compras que se puedan corregir con esa búsqueda.</div>}
            <div className="flex flex-col gap-1.5">
              {matches.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className="text-left border border-rule rounded px-3 py-2 hover:border-teal cursor-pointer"
                  onClick={() => { setSelectedId(e.id); setErr(""); setMsg(""); }}
                >
                  <div className="flex items-center gap-2 flex-wrap text-[13px]">
                    <span className="font-semibold">{e.productName}</span>
                    <span className="text-steel">· {e.supplierName}</span>
                    <span className="ml-auto tabular-nums font-semibold">{e.quantity} un. × {money(e.unitCost)}</span>
                  </div>
                  <div className="text-[11px] text-steel-dim">{e.code ? `${e.code} · ` : ""}{STATUS_LABEL[e.status] ?? e.status} · {formatDateTime(e.requestedAt)}</div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2.5">
            <div className="border border-teal rounded px-3 py-2 text-[13px]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{selected.productName}</span>
                <span className="text-steel">· {selected.supplierName}</span>
                <button type="button" className="ml-auto text-[12px] text-steel cursor-pointer" onClick={() => setSelectedId(null)}>Cambiar</button>
              </div>
              <div className="text-[11px] text-steel-dim">{selected.code ? `${selected.code} · ` : ""}{selected.quantity} un. · precio actual {money(selected.unitCost)} por unidad</div>
            </div>
            <label className="text-[12px] font-semibold">
              Precio nuevo por unidad (lo que se acordó con el proveedor)
              <input
                className="mt-1 text-[13px] rounded border border-rule bg-cloud px-2.5 py-2 w-full tabular-nums"
                inputMode="decimal"
                placeholder="Ej: 10.00"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
              />
            </label>
            {priceOk && (
              <div className="text-[12.5px]">
                {money(selected.unitCost)} → <strong>{money(parsedPrice)}</strong> · total {money(selected.quantity * selected.unitCost)} → <strong>{money(selected.quantity * parsedPrice)}</strong>{" "}
                <span className={parsedPrice < selected.unitCost ? "text-green" : "text-red"}>
                  ({parsedPrice < selected.unitCost ? "−" : "+"}{money(Math.abs(selected.quantity * (parsedPrice - selected.unitCost)))})
                </span>
              </div>
            )}
            <label className="text-[12px] font-semibold">
              ¿Qué se negoció y quién lo negoció?
              <textarea
                className="mt-1 text-[13px] rounded border border-rule bg-cloud px-2.5 py-2 w-full"
                rows={2}
                placeholder="Ej: Bryan negoció con CHEN a $10, la solicitud quedó a $10.50 por error."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="text-[12px] font-semibold">Captura del acuerdo con el proveedor (obligatoria)</div>
            {!proof ? (
              <label className={`text-[12.5px] border border-dashed border-rule rounded px-3 py-2.5 text-center cursor-pointer ${uploading ? "opacity-60" : ""}`}>
                {uploading ? "Subiendo…" : "Subir captura del chat"}
                <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => e.target.files?.[0] && uploadProof(e.target.files[0])} />
              </label>
            ) : (
              <div className="flex items-center gap-2">
                <ProofPreview url={proof.url} size={40} filename={proof.name} />
                <button type="button" className="text-[12px] text-steel cursor-pointer" onClick={() => setProof(null)}>Quitar</button>
              </div>
            )}
            <button
              type="button"
              disabled={busy || uploading || !priceOk || !reason.trim() || !proof}
              className="self-start text-[12.5px] font-bold bg-teal text-white rounded px-3.5 py-2 cursor-pointer disabled:opacity-50"
              onClick={submit}
            >
              {data.isAdmin ? "Registrar corrección" : "Enviar al admin"}
            </button>
          </div>
        )}
      </div>

      {/* Esperando al admin */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2.5">
          Esperando aprobación del admin ({pending.length})
        </div>
        {pending.length === 0 && (
          <div className="border-[1.5px] border-dashed border-rule rounded-md p-5 text-center text-steel text-[13px]">Nada pendiente.</div>
        )}
        <div className="flex flex-col gap-2">
          {pending.map((c) => (
            <CorrectionCard key={c.id} c={c}>
              {data.isAdmin && (
                rejectingId === c.id ? (
                  <div className="mt-2.5 pt-2.5 border-t border-rule">
                    <input
                      className="text-[12px] rounded border border-rule bg-cloud px-2 py-1.5 w-full mb-2"
                      placeholder="¿Por qué la rechazas?"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button type="button" disabled={busy || !rejectReason.trim()} className="text-[12px] font-bold bg-red text-white rounded px-3 py-1.5 cursor-pointer disabled:opacity-50" onClick={() => review(c.id, "reject")}>
                        Rechazar
                      </button>
                      <button type="button" className="text-[12px] text-steel cursor-pointer" onClick={() => { setRejectingId(null); setRejectReason(""); }}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2.5 pt-2.5 border-t border-rule">
                    <div className="text-[11.5px] text-steel mb-2">
                      Al aprobar: la compra queda a {money(c.newUnitCost)} por unidad, la deuda y la hoja del proveedor se actualizan solas
                      {c.inKardex ? ", y en el Kardex se agrega una línea de \"Ajuste de precio\" para lo que sigue en bodega." : ". Todavía no entró al Kardex, así que entrará directo con el precio nuevo."}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" disabled={busy} className="text-[12px] font-bold bg-green text-white rounded px-3 py-1.5 cursor-pointer disabled:opacity-50" onClick={() => review(c.id, "approve")}>
                        Aprobar corrección
                      </button>
                      <button type="button" disabled={busy} className="text-[12px] font-semibold text-red cursor-pointer" onClick={() => setRejectingId(c.id)}>
                        Rechazar
                      </button>
                    </div>
                  </div>
                )
              )}
            </CorrectionCard>
          ))}
        </div>
      </div>

      {/* Historial */}
      {history.length > 0 && (
        <details>
          <summary className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2.5 cursor-pointer">Historial ({history.length})</summary>
          <div className="flex flex-col gap-2">
            {history.map((c) => (
              <CorrectionCard key={c.id} c={c} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function CorrectionCard({ c, children }: { c: Correction; children?: ReactNode }) {
  const diff = c.quantity * (c.newUnitCost - c.oldUnitCost);
  return (
    <div className="bg-surface border border-rule rounded-md p-3.5">
      <div className="flex items-center gap-2 flex-wrap text-[13px]">
        <span className="font-bold">{c.productName}</span>
        <span className="text-steel">· {c.supplierName}</span>
        {c.status === "APPROVED" && <span className="text-[11px] font-semibold text-green ml-auto">Aprobada</span>}
        {c.status === "REJECTED" && <span className="text-[11px] font-semibold text-red ml-auto">Rechazada</span>}
      </div>
      <div className="text-[13px] mt-1 tabular-nums">
        {money(c.oldUnitCost)} → <strong>{money(c.newUnitCost)}</strong> · {c.quantity} un. ·{" "}
        <span className={diff < 0 ? "text-green" : "text-red"}>{diff < 0 ? "−" : "+"}{money(Math.abs(diff))}</span>
      </div>
      <div className="text-[12.5px] mt-1">{c.reason}</div>
      <div className="flex items-center gap-2 mt-1.5">
        <ProofPreview url={c.proofUrl} size={36} filename={c.proofName ?? "captura-acuerdo"} />
        <div className="text-[11px] text-steel-dim">
          {c.code ? `${c.code} · ` : ""}Pedida por {c.requestedByName ?? "Administración"} · {formatDateTime(c.requestedAt)}
          {c.reviewedAt && <> · revisada {formatDateTime(c.reviewedAt)}</>}
          {c.status === "APPROVED" && c.kardexAdjustedUnits != null && <> · Kardex: ajuste sobre {c.kardexAdjustedUnits} un. en bodega</>}
        </div>
      </div>
      {c.status === "REJECTED" && c.rejectReason && <div className="text-[12px] text-red mt-1">Motivo: {c.rejectReason}</div>}
      {children}
    </div>
  );
}
