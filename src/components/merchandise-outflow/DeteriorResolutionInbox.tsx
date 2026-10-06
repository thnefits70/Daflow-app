"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, PackageMinus, TrendingUp } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { formatDateTime } from "@/lib/formatDateTime";
import { ExpandableName } from "@/components/ui/ExpandableName";

type ItemDTO = {
  id: string;
  declaredName: string;
  quantity: number;
  photoUrls: string[];
  catalogItem: { name: string; photos: string[]; justCode: string | null } | null;
  damageReason: { name: string } | null;
  damageReasonOther: string | null;
  batch: { code: string; createdAt: string; createdBy: { name: string } | null; supplier: { name: string } | null; documentPhotoUrls: string[] };
};

type Resolution = "SOLVED_ONSITE" | "WRITE_OFF" | "ESCALATED_TO_PURCHASES";

const RESOLUTION_LABEL: Record<Resolution, string> = {
  SOLVED_ONSITE: "Solucionado ahí mismo",
  WRITE_OFF: "Dar de baja",
  ESCALATED_TO_PURCHASES: "Escalar a Compras",
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

export function DeteriorResolutionInbox({ canAct }: { canAct: boolean }) {
  const [items, setItems] = useState<ItemDTO[] | null>(null);
  const [choosing, setChoosing] = useState<{ id: string; resolution: Resolution } | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Pedido de Daniel 2026-09-28: recuadro "Seleccionar todo" arriba a la
  // derecha para resolver varios reportes de una vez, con una pregunta de
  // confirmación para evitar un toque sin querer.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkChoosing, setBulkChoosing] = useState<Resolution | null>(null);
  const [bulkNote, setBulkNote] = useState("");
  const [bulkError, setBulkError] = useState("");

  function load() {
    fetch("/api/merchandise-outflow/deterioro")
      .then((r) => r.json())
      .then((data: ItemDTO[]) => {
        setItems(data);
        const ids = new Set(data.map((i) => i.id));
        setSelected((prev) => new Set([...prev].filter((id) => ids.has(id))));
      })
      .catch(() => setItems([]));
  }
  useEffect(load, []);

  async function resolve() {
    if (!choosing) return;
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/merchandise-outflow/items/${choosing.id}/resolve`, { resolution: choosing.resolution, note: note.trim() || undefined });
      setChoosing(null);
      setNote("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo resolver.");
    } finally {
      setSaving(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function cancelBulk() {
    setBulkChoosing(null);
    setBulkNote("");
    setBulkError("");
  }

  async function resolveBulk() {
    if (!bulkChoosing || !items) return;
    const ids = items.filter((i) => selected.has(i.id)).map((i) => i.id);
    setSaving(true);
    setBulkError("");
    let failed = 0;
    let lastError = "";
    // Uno por uno: si alguno falla (p. ej. ya lo resolvió otra persona),
    // los demás igual quedan resueltos.
    for (const id of ids) {
      try {
        await postJson(`/api/merchandise-outflow/items/${id}/resolve`, { resolution: bulkChoosing, note: bulkNote.trim() || undefined });
      } catch (e) {
        failed++;
        lastError = e instanceof Error ? e.message : "No se pudo resolver.";
      }
    }
    setSaving(false);
    if (failed > 0) {
      setBulkError(`${failed} de ${ids.length} no se pudieron resolver: ${lastError}`);
    } else {
      cancelBulk();
      setSelected(new Set());
    }
    load();
  }

  const header = <div className="font-display font-bold text-[14px]">Pendientes de resolución</div>;

  if (items === null) return <div>{header}<div className="text-[13px] text-steel mt-2.5">Cargando…</div></div>;
  if (items.length === 0) return <div>{header}<div className="text-[13px] text-steel mt-2.5">No hay deterioros pendientes de resolución.</div></div>;

  const allSelected = items.every((i) => selected.has(i.id));
  const selectedCount = items.filter((i) => selected.has(i.id)).length;
  const bulkTarget = allSelected ? "todo" : selectedCount === 1 ? "el producto seleccionado" : `los ${selectedCount} productos seleccionados`;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      <div className="flex items-center justify-between gap-3">
        {header}
        {canAct && (
          <label className="flex items-center gap-1.5 text-[12px] font-semibold text-steel cursor-pointer select-none">
            Seleccionar todo
            <input
              type="checkbox"
              className="w-5 h-5 cursor-pointer"
              checked={allSelected}
              onChange={() => {
                cancelBulk();
                setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));
              }}
            />
          </label>
        )}
      </div>

      {canAct && selectedCount > 0 && (
        <div className="sticky top-2 z-10 bg-cloud border border-teal/50 rounded-md p-3 shadow-sm">
          {bulkChoosing ? (
            <>
              <div className="text-[12.5px] font-semibold mb-1.5">
                ¿Estás seguro que {bulkTarget} lo reportas como &quot;{RESOLUTION_LABEL[bulkChoosing]}&quot;?
              </div>
              {bulkChoosing !== "SOLVED_ONSITE" && (
                <textarea
                  className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px] mb-2"
                  rows={2}
                  value={bulkNote}
                  onChange={(e) => setBulkNote(e.target.value)}
                  placeholder={bulkChoosing === "WRITE_OFF" ? "Explica por qué no se puede arreglar (vale para todos)…" : "Explica qué se va a pedir al proveedor (vale para todos)…"}
                />
              )}
              {bulkError && <div className="text-red text-[11px] mb-1.5">{bulkError}</div>}
              <div className="flex gap-2">
                <button type="button" disabled={saving} className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer disabled:opacity-40" onClick={cancelBulk}>
                  No, cancelar
                </button>
                <button
                  type="button"
                  disabled={saving || (bulkChoosing !== "SOLVED_ONSITE" && !bulkNote.trim())}
                  className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40"
                  onClick={resolveBulk}
                >
                  {saving ? "Guardando…" : "Sí, confirmar"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-[12px] font-semibold mb-2">
                {allSelected ? `Todo seleccionado (${selectedCount})` : `${selectedCount} seleccionado${selectedCount === 1 ? "" : "s"}`} — ¿cómo lo reportas?
              </div>
              <div className="flex gap-1.5 flex-wrap">
                <button type="button" className="flex items-center gap-1 text-[11.5px] font-semibold border border-green/40 text-green rounded-full px-2.5 py-1 cursor-pointer" onClick={() => setBulkChoosing("SOLVED_ONSITE")}>
                  <CheckCircle2 size={12} /> Solucionado ahí mismo
                </button>
                <button type="button" className="flex items-center gap-1 text-[11.5px] font-semibold border border-red/40 text-red rounded-full px-2.5 py-1 cursor-pointer" onClick={() => setBulkChoosing("WRITE_OFF")}>
                  <PackageMinus size={12} /> Dar de baja
                </button>
                <button type="button" className="flex items-center gap-1 text-[11.5px] font-semibold border border-blue/40 text-blue rounded-full px-2.5 py-1 cursor-pointer" onClick={() => setBulkChoosing("ESCALATED_TO_PURCHASES")}>
                  <TrendingUp size={12} /> Escalar a Compras
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {items.map((item) => (
        <div key={item.id} className={`bg-surface border rounded-md p-3.5 ${selected.has(item.id) ? "border-teal" : "border-rule"}`}>
          <div className="flex items-center gap-3 mb-2.5">
            {(item.photoUrls[0] ?? item.batch.documentPhotoUrls[0]) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img loading="lazy" decoding="async" src={item.photoUrls[0] ?? item.batch.documentPhotoUrls[0]} alt={itemName(item)} className="w-12 h-12 object-cover rounded border border-rule shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold flex items-center gap-1.5 min-w-0">
                {item.catalogItem && <CatalogCode code={item.catalogItem.justCode} />}
                <ExpandableName text={itemName(item)} />
              </div>
              <div className="text-[11px] text-steel">{item.quantity} un. · {item.damageReason?.name ?? item.damageReasonOther ?? "Sin motivo"}</div>
              <div className="text-[10.5px] text-steel">
                {item.batch.code} · {item.batch.createdBy?.name ?? "—"} · {formatDateTime(item.batch.createdAt)}
                {item.batch.supplier && <> · Proveedor: <span className="font-semibold text-ink">{item.batch.supplier.name}</span></>}
              </div>
            </div>
            {canAct && (
              <input
                type="checkbox"
                aria-label={`Seleccionar ${itemName(item)}`}
                className="w-5 h-5 cursor-pointer shrink-0 self-start"
                checked={selected.has(item.id)}
                onChange={() => { cancelBulk(); toggle(item.id); }}
              />
            )}
          </div>
          {/* Desde 2026-09-26 un reporte de deterioro puede traer varias fotos. */}
          {item.batch.documentPhotoUrls.length > 1 && (
            <div className="flex gap-1.5 flex-wrap mb-2.5">
              {item.batch.documentPhotoUrls.map((p, i) => (
                <a key={p} href={p} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img loading="lazy" decoding="async" src={p} alt={`Foto ${i + 1}`} className="w-14 h-14 object-cover rounded border border-rule" />
                </a>
              ))}
            </div>
          )}

          {!canAct ? (
            <div className="text-[11.5px] text-steel">Solo Daniel puede resolver este reporte.</div>
          ) : choosing?.id === item.id ? (
            <div className="bg-cloud rounded-md p-2.5">
              <div className="text-[12px] font-semibold mb-1.5">
                {choosing.resolution === "SOLVED_ONSITE" ? "¿Confirmar que se solucionó ahí mismo?" : choosing.resolution === "WRITE_OFF" ? "Explica por qué no se puede arreglar" : "Explica qué se va a pedir al proveedor"}
              </div>
              {choosing.resolution !== "SOLVED_ONSITE" && (
                <textarea className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px] mb-2" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota breve…" />
              )}
              {error && <div className="text-red text-[11px] mb-1.5">{error}</div>}
              <div className="flex gap-2">
                <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => { setChoosing(null); setNote(""); setError(""); }}>
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={saving || (choosing.resolution !== "SOLVED_ONSITE" && !note.trim())}
                  className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40"
                  onClick={resolve}
                >
                  {saving ? "Guardando…" : "Confirmar"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-1.5 flex-wrap">
              <button type="button" className="flex items-center gap-1 text-[11.5px] font-semibold border border-green/40 text-green rounded-full px-2.5 py-1 cursor-pointer" onClick={() => setChoosing({ id: item.id, resolution: "SOLVED_ONSITE" })}>
                <CheckCircle2 size={12} /> Solucionado ahí mismo
              </button>
              <button type="button" className="flex items-center gap-1 text-[11.5px] font-semibold border border-red/40 text-red rounded-full px-2.5 py-1 cursor-pointer" onClick={() => setChoosing({ id: item.id, resolution: "WRITE_OFF" })}>
                <PackageMinus size={12} /> Dar de baja
              </button>
              <button type="button" className="flex items-center gap-1 text-[11.5px] font-semibold border border-blue/40 text-blue rounded-full px-2.5 py-1 cursor-pointer" onClick={() => setChoosing({ id: item.id, resolution: "ESCALATED_TO_PURCHASES" })}>
                <TrendingUp size={12} /> Escalar a Compras
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
