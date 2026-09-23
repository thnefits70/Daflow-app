"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Package, Pencil, Plus, X } from "lucide-react";
import { ExpandableName } from "@/components/ui/ExpandableName";

export type VariantNote = { label: string; quantity: number };
export type CompiledLine = { catalogItemId: string; name: string; photos: string[]; quantity: number; variants: VariantNote[] };
export type CompiledBatch = { id: string; source: string; requestedAt: string; requestedByName: string; totalRows: number; skippedCount: number; lines: CompiledLine[] };
export type BatchListItem = { id: string; source: string; requestedAt: string; requestedByName: string; totalRows: number; skippedCount: number; lineCount: number };

export function fmt(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function sourceLabel(source: string) {
  return source === "ROCKET" ? "Rocket" : "Dropi";
}

// Confirmado 2026-09-21: la versión digital de lo que Yair anotaba a mano en
// el papel junto a cada producto ("5 rojas, 3 azules") — INVESTOCK sigue sin
// llevar stock por variante, esto es solo la guía de picking que antes se
// perdía en el papel. Solo quien puede subir la solicitud (Yair/FUL) edita;
// Daniel/admin lo ven de solo lectura.
function VariantsBlock({ batchId, line, canEdit, onSaved }: { batchId: string; line: CompiledLine; canEdit: boolean; onSaved: (variants: VariantNote[]) => void }) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<VariantNote[]>(line.variants.length > 0 ? line.variants : [{ label: "", quantity: 0 }]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const sum = rows.reduce((s, r) => s + (Number.isFinite(r.quantity) ? r.quantity : 0), 0);
  const matches = sum === line.quantity;

  function startEdit() {
    setRows(line.variants.length > 0 ? line.variants.map((v) => ({ ...v })) : [{ label: "", quantity: 0 }]);
    setErr("");
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setErr("");
    const cleaned = rows.filter((r) => r.label.trim() && r.quantity > 0);
    const res = await fetch(`/api/fulfillment-requests/${batchId}/variants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogItemId: line.catalogItemId, variants: cleaned }),
    });
    const json = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo guardar.");
      return;
    }
    onSaved(json.variants ?? []);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
        {line.variants.map((v, i) => (
          <span key={i} className="font-mono text-[10px] bg-navy/5 border border-rule rounded-full px-2 py-0.5">
            {v.label}: {v.quantity}
          </span>
        ))}
        {canEdit && (
          <button type="button" className="flex items-center gap-1 text-[10.5px] font-semibold text-steel hover:text-teal cursor-pointer" onClick={startEdit}>
            <Pencil size={10} /> {line.variants.length > 0 ? "Editar variantes" : "Agregar variantes"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-1.5 bg-navy/5 rounded-md p-2.5">
      <div className="flex flex-col gap-1.5 mb-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="text"
              placeholder="Ej. Rojo, Talla M…"
              className="flex-1 min-w-0 rounded border border-rule bg-surface px-2 py-1 text-[11.5px]"
              value={r.label}
              onChange={(e) => setRows((prev) => prev.map((row, idx) => (idx === i ? { ...row, label: e.target.value } : row)))}
            />
            <input
              type="number"
              min={0}
              placeholder="0"
              className="w-16 rounded border border-rule bg-surface px-2 py-1 text-[11.5px]"
              value={r.quantity || ""}
              onChange={(e) => setRows((prev) => prev.map((row, idx) => (idx === i ? { ...row, quantity: parseInt(e.target.value, 10) || 0 } : row)))}
            />
            <button type="button" className="text-steel hover:text-red cursor-pointer shrink-0" onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}>
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="flex items-center gap-1 text-[10.5px] font-semibold text-teal cursor-pointer mb-2" onClick={() => setRows((prev) => [...prev, { label: "", quantity: 0 }])}>
        <Plus size={11} /> Agregar variante
      </button>
      <div className={`text-[11px] font-semibold mb-2 ${matches ? "text-teal" : "text-red"}`}>
        Suma: {sum} / {line.quantity} {matches ? "✓" : "— debe cuadrar con el total antes de guardar"}
      </div>
      {err && <div className="text-red text-[11px] mb-2">{err}</div>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving || !matches}
          className="rounded border border-teal bg-teal px-2.5 py-1 text-[11px] font-bold text-navy cursor-pointer disabled:opacity-50"
          onClick={save}
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" className="text-[11px] text-steel cursor-pointer" onClick={() => setEditing(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

export function CompiledResult({ batch, canEditVariants = false }: { batch: CompiledBatch; canEditVariants?: boolean }) {
  const [lines, setLines] = useState(batch.lines);
  return (
    <div className="bg-surface border border-rule rounded-md p-4 mb-5">
      <div className="flex items-center gap-1.5 text-teal text-[13px] font-bold mb-1">
        <CheckCircle2 size={15} /> Compendiado listo — {sourceLabel(batch.source)}
      </div>
      <div className="text-[11.5px] text-steel mb-3">
        {fmt(batch.requestedAt)} · subido por {batch.requestedByName} · {batch.totalRows} filas del archivo
        {batch.skippedCount > 0 ? `, ${batch.skippedCount} ignoradas` : ""} → {batch.lines.length} productos reales distintos.
      </div>
      <div className="flex flex-col gap-1.5 max-h-[32rem] overflow-y-auto">
        {lines.map((l) => (
          <div key={l.catalogItemId} className="bg-cloud rounded-md px-3 py-2">
            <div className="flex items-center gap-2.5">
              {l.photos[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.photos[0]} alt="" className="w-7 h-7 object-cover rounded border border-rule shrink-0" />
              ) : (
                <div className="w-7 h-7 rounded border border-dashed border-rule shrink-0 flex items-center justify-center text-steel">
                  <Package size={12} />
                </div>
              )}
              <ExpandableName text={l.name} className="text-[12.5px] flex-1" />
              <span className="font-mono text-[13px] font-bold text-teal shrink-0">{l.quantity}</span>
            </div>
            <VariantsBlock
              batchId={batch.id}
              line={l}
              canEdit={canEditVariants}
              onSaved={(variants) => setLines((prev) => prev.map((row) => (row.catalogItemId === l.catalogItemId ? { ...row, variants } : row)))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function FulfillmentHistoryList({ history, onView }: { history: BatchListItem[]; onView: (id: string) => void }) {
  const [show, setShow] = useState(false);
  if (history.length === 0) return null;
  return (
    <div>
      <button type="button" className="flex items-center gap-1 text-[11px] font-semibold text-steel hover:text-teal cursor-pointer" onClick={() => setShow((s) => !s)}>
        {show ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Historial de subidas ({history.length})
      </button>
      {show && (
        <div className="mt-2 flex flex-col gap-1">
          {history.map((b) => (
            <button key={b.id} type="button" className="text-left text-[11px] text-steel hover:text-teal cursor-pointer flex flex-wrap items-center gap-x-1.5" onClick={() => onView(b.id)}>
              <span className="font-mono">{fmt(b.requestedAt)}</span>
              <span>—</span>
              <span className="font-semibold">{b.requestedByName}</span>
              <span>
                · {sourceLabel(b.source)} · {b.totalRows} filas{b.skippedCount > 0 ? `, ${b.skippedCount} ignoradas` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
