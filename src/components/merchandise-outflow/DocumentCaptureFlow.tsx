"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Check, Pencil, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { LiveCameraCapture } from "@/components/shared/LiveCameraCapture";
import { ProductMatchPicker, type MatchCatalogItem, type ProductMatchResult } from "@/components/merchandise-reentry/ProductMatchPicker";
import { ComboComponentBuilder, type ComboDraftComponent } from "@/components/merchandise-reentry/ComboComponentBuilder";

type ItemDTO = { id: string; declaredName: string; quantity: number; catalogItem: { name: string; photos: string[] } | null };
type BatchDTO = { id: string; code: string; documentPhotoUrls: string[]; items: ItemDTO[] };
type Confidence = "alta" | "media" | "baja";
type SuggestedRow = {
  name: string;
  quantity: number;
  confidence: Confidence;
  selected: MatchCatalogItem | null;
  manualName: string;
  adding?: boolean;
  added?: boolean;
  sourceCode?: string | null;
  fromCombo?: string | null;
  comboUnits?: number | null;
  comboBuilderOpen?: boolean;
  comboDraft?: ComboDraftComponent[];
  savingCombo?: boolean;
  editingName?: boolean;
};

const MAX_PHOTOS = 40;
const CONFIDENCE_LABEL: Record<Confidence, string> = { alta: "Lectura clara", media: "Revisar: letra poco clara", baja: "Revisar: dudosa" };
const CONFIDENCE_STYLE: Record<Confidence, string> = {
  alta: "bg-green/10 text-green border-green/35",
  media: "bg-yellow/10 text-yellow border-yellow/35",
  baja: "bg-red/10 text-red border-red/35",
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

export function DocumentCaptureFlow({ reason, canManageJustCatalog = false }: { reason: "DESPACHO" | "GARANTIA"; canManageJustCatalog?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [batch, setBatch] = useState<BatchDTO | null>(null);
  const [error, setError] = useState("");
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sentCode, setSentCode] = useState<string | null>(null);
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null);
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState(false);

  const [photos, setPhotos] = useState<string[]>([]);
  const [zoomedPhoto, setZoomedPhoto] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [taking, setTaking] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [rows, setRows] = useState<SuggestedRow[]>([]);
  const [manualMode, setManualMode] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualQty, setManualQty] = useState("");
  const [manualSelected, setManualSelected] = useState<MatchCatalogItem | null>(null);

  function startLongPress(url: string) {
    longPressTimer.current = setTimeout(() => setZoomedPhoto(url), 450);
  }
  function cancelLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  }

  function loadDraft() {
    fetch(`/api/merchandise-outflow/draft?reason=${reason}`)
      .then((r) => r.json())
      .then((data) => setBatch(data ?? null))
      .catch(() => setBatch(null))
      .finally(() => setLoading(false));
  }

  useEffect(loadDraft, [reason]);

  async function start() {
    setError("");
    try {
      const created = await postJson("/api/merchandise-outflow/draft", { reason });
      setBatch({ ...created, items: created.items ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el lote.");
    }
  }

  async function runExtract() {
    if (!batch || photos.length === 0) return;
    setExtracting(true);
    setError("");
    try {
      const result = await postJson(`/api/merchandise-outflow/batches/${batch.id}/extract`, { photoUrls: photos });
      if (result.error) setError(result.error);
      setRows(
        (result.rows ?? []).map(
          (r: {
            name: string;
            quantity: number;
            confidence?: Confidence;
            catalogItem?: MatchCatalogItem | null;
            sourceCode?: string | null;
            fromCombo?: string | null;
            comboUnits?: number | null;
          }) => ({
            name: r.name,
            quantity: r.quantity,
            confidence: r.confidence ?? "media",
            selected: r.catalogItem ?? null,
            manualName: "",
            sourceCode: r.sourceCode ?? null,
            fromCombo: r.fromCombo ?? null,
            comboUnits: r.comboUnits ?? null,
          })
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el documento.");
    } finally {
      setExtracting(false);
    }
  }

  async function addRow(index: number) {
    const row = rows[index];
    if (!batch || (!row.selected && !row.manualName.trim())) return;
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, adding: true } : r)));
    try {
      await postJson(`/api/merchandise-outflow/batches/${batch.id}/items`, {
        catalogItemId: row.selected?.id,
        declaredName: row.selected ? undefined : row.manualName.trim(),
        quantity: row.quantity,
      });
      setRows((rs) => rs.map((r, i) => (i === index ? { ...r, adding: false, added: true } : r)));
      loadDraft();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo agregar el producto.");
      setRows((rs) => rs.map((r, i) => (i === index ? { ...r, adding: false } : r)));
    }
  }

  async function addAllMatched() {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].selected && !rows[i].added && !rows[i].adding) await addRow(i);
    }
  }

  // Confirmado 2026-08-26 (pedido explícito del usuario): Daniel puede
  // desglosar un combo de Dropi nuevo AHÍ MISMO cuando "Leer con IA" no lo
  // reconoce, en vez de tener que ir a Base de datos de productos — se
  // guarda para reutilizarse solo en próximas lecturas (DropiCombo) y de
  // una vez reemplaza este renglón por sus productos reales ya resueltos.
  // Corregido el mismo día (reportado por Daniel): un código a veces
  // coincide CON CONFIANZA pero MAL contra un producto real del catálogo
  // (colisión de datos) — por eso esto también se ofrece cuando la fila ya
  // tiene un `selected`, no solo cuando quedó sin reconocer.
  async function saveComboAndExpand(index: number) {
    const row = rows[index];
    if (!row.sourceCode || !row.comboDraft || row.comboDraft.length === 0) return;
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, savingCombo: true } : r)));
    try {
      const combo = await postJson("/api/dropi-combos", {
        code: row.sourceCode,
        components: row.comboDraft.map((c) => ({ catalogItemId: c.catalogItem.id, quantity: c.quantity })),
      });
      const expanded: SuggestedRow[] = combo.components.map((comp: { quantity: number; catalogItem: MatchCatalogItem }) => ({
        name: comp.catalogItem.name,
        quantity: comp.quantity * row.quantity,
        confidence: row.confidence,
        selected: comp.catalogItem,
        manualName: "",
        fromCombo: combo.code,
        comboUnits: row.quantity,
      }));
      setRows((rs) => [...rs.slice(0, index), ...expanded, ...rs.slice(index + 1)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el combo.");
      setRows((rs) => rs.map((r, i) => (i === index ? { ...r, savingCombo: false } : r)));
    }
  }

  // Confirmado 2026-08-26 (reportado por Daniel): un combo YA registrado
  // puede tener la receta equivocada (ej. le falta un producto, o trae uno
  // que no es) — abre el mismo builder pero precargado con los componentes
  // actuales de ese combo, para que Daniel los corrija.
  async function openComboCorrection(index: number) {
    const row = rows[index];
    if (!row.fromCombo) return;
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, comboBuilderOpen: true, comboDraft: [] } : r)));
    try {
      const combos = await fetch("/api/dropi-combos").then((r) => (r.ok ? r.json() : []));
      const combo = (combos as { code: string; components: { quantity: number; catalogItem: MatchCatalogItem }[] }[]).find((c) => c.code === row.fromCombo);
      if (combo) {
        const draft: ComboDraftComponent[] = combo.components.map((c) => ({ catalogItem: c.catalogItem, quantity: c.quantity }));
        setRows((rs) => rs.map((r, i) => (i === index ? { ...r, comboDraft: draft } : r)));
      }
    } catch {
      // Si falla la precarga, Daniel igual puede armar la lista desde cero.
    }
  }

  // Confirmado 2026-08-26: al corregir un combo YA registrado, se actualiza
  // la receta estándar (para futuras lecturas) Y de una vez se reemplazan
  // TODAS las filas de ESTE lote que vinieron de ese mismo combo por la
  // versión corregida — usando comboUnits (cuántos combos se despacharon
  // según el papel) para recalcular las cantidades correctas.
  async function saveComboCorrectionAndReexpand(index: number) {
    const row = rows[index];
    const code = row.fromCombo;
    if (!code || !row.comboDraft || row.comboDraft.length === 0) return;
    const units = row.comboUnits ?? 1;
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, savingCombo: true } : r)));
    try {
      const combo = await postJson("/api/dropi-combos", {
        code,
        components: row.comboDraft.map((c) => ({ catalogItemId: c.catalogItem.id, quantity: c.quantity })),
      });
      const expanded: SuggestedRow[] = combo.components.map((comp: { quantity: number; catalogItem: MatchCatalogItem }) => ({
        name: comp.catalogItem.name,
        quantity: comp.quantity * units,
        confidence: row.confidence,
        selected: comp.catalogItem,
        manualName: "",
        fromCombo: code,
        comboUnits: units,
      }));
      setRows((rs) => {
        const firstIdx = rs.findIndex((r) => r.fromCombo === code);
        const others = rs.filter((r) => r.fromCombo !== code);
        const insertAt = rs.slice(0, firstIdx).filter((r) => r.fromCombo !== code).length;
        return [...others.slice(0, insertAt), ...expanded, ...others.slice(insertAt)];
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el combo.");
      setRows((rs) => rs.map((r, i) => (i === index ? { ...r, savingCombo: false } : r)));
    }
  }

  async function addManual() {
    if (!batch) return;
    const qty = Number(manualQty) || 0;
    if (qty <= 0 || (!manualSelected && !manualName.trim())) return;
    setError("");
    try {
      await postJson(`/api/merchandise-outflow/batches/${batch.id}/items`, {
        catalogItemId: manualSelected?.id,
        declaredName: manualSelected ? undefined : manualName.trim(),
        quantity: qty,
      });
      setManualMode(false);
      setManualName("");
      setManualQty("");
      setManualSelected(null);
      loadDraft();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo agregar el producto.");
    }
  }

  async function deleteItem(itemId: string) {
    await fetch(`/api/merchandise-outflow/items/${itemId}`, { method: "DELETE" });
    setConfirmDeleteItemId(null);
    loadDraft();
  }

  async function deleteBatch() {
    if (!batch) return;
    await fetch(`/api/merchandise-outflow/batches/${batch.id}`, { method: "DELETE" });
    setBatch(null);
    setConfirmDeleteBatch(false);
    setPhotos([]);
    setRows([]);
  }

  async function submitBatch() {
    if (!batch) return;
    setSubmitting(true);
    setError("");
    try {
      await postJson(`/api/merchandise-outflow/batches/${batch.id}/submit`);
      setSentCode(batch.code);
      setBatch(null);
      setConfirmingSubmit(false);
      setPhotos([]);
      setRows([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar el lote.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="text-[13px] text-steel">Cargando…</div>;

  if (sentCode) {
    return (
      <div className="bg-surface border border-rule rounded-md p-6 max-w-sm text-center">
        <div className="w-11 h-11 rounded-full bg-green/15 border border-green/40 flex items-center justify-center mx-auto mb-3">
          <Check size={20} className="text-green" />
        </div>
        <div className="font-display font-bold text-[15px] mb-1.5">{sentCode} enviado</div>
        <p className="text-[12.5px] text-steel mb-4">Va a la cola de &quot;Dar de baja en Just&quot;.</p>
        <button type="button" className="text-[12.5px] font-bold text-teal cursor-pointer" onClick={() => setBatch(null)}>
          Empezar un lote nuevo
        </button>
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="bg-surface border border-rule rounded-md p-6 max-w-sm">
        {error && <div className="text-red text-[12px] mb-2">{error}</div>}
        <button type="button" className="rounded border border-teal bg-teal px-3.5 py-2.5 text-[13px] font-bold text-navy cursor-pointer" onClick={start}>
          Empezar a capturar
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-bold text-teal">{batch.code}</span>
          <span className="font-mono text-[10px] text-steel bg-cloud rounded-full px-2 py-0.5">{batch.items.length} producto(s) agregados</span>
        </div>
        {!confirmDeleteBatch && (
          <button type="button" className="flex items-center gap-1 text-[11px] font-semibold text-steel hover:text-red cursor-pointer" onClick={() => setConfirmDeleteBatch(true)}>
            <Trash2 size={12} /> Cancelar lote
          </button>
        )}
      </div>

      {confirmDeleteBatch && (
        <div className="bg-red/10 border border-red/40 rounded-md p-3.5 mb-3">
          <div className="font-display font-bold text-[13.5px] mb-1">¿Eliminar todo el lote {batch.code}?</div>
          <p className="text-[12px] text-steel mb-3">Esto no se puede deshacer.</p>
          <div className="flex gap-2">
            <button type="button" className="flex-1 rounded border border-rule px-3 py-2 text-[12px] font-semibold cursor-pointer" onClick={() => setConfirmDeleteBatch(false)}>
              No, mantener
            </button>
            <button type="button" className="flex-1 rounded border border-red bg-red px-3 py-2 text-[12px] font-bold text-white cursor-pointer" onClick={deleteBatch}>
              Sí, eliminar
            </button>
          </div>
        </div>
      )}

      {batch.items.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-4">
          {batch.items.map((item) =>
            confirmDeleteItemId === item.id ? (
              <div key={item.id} className="bg-red/10 border border-red/40 rounded-md p-2.5 flex items-center justify-between gap-2">
                <span className="text-[12px]">¿Quitar &quot;{itemName(item)}&quot;?</span>
                <div className="flex gap-1.5 shrink-0">
                  <button type="button" className="text-[11px] font-semibold cursor-pointer" onClick={() => setConfirmDeleteItemId(null)}>Cancelar</button>
                  <button type="button" className="text-[11px] font-bold text-red cursor-pointer" onClick={() => deleteItem(item.id)}>Sí, quitar</button>
                </div>
              </div>
            ) : (
              <div key={item.id} className="bg-surface border border-rule rounded-md p-2.5 flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-semibold">{itemName(item)}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-[11px] text-steel">{item.quantity} un.</span>
                  <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => setConfirmDeleteItemId(item.id)}>
                    <X size={13} />
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}

      <div className="bg-surface border border-rule rounded-md p-3.5 mb-3">
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">
          {reason === "DESPACHO" ? "Fotos de la hoja de despacho" : "Fotos del manifiesto de garantía"}
        </label>
        <div className="flex gap-2 flex-wrap mb-2">
          {photos.map((p, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p}
                alt={`Foto ${i + 1}`}
                className="w-16 h-16 object-cover rounded border border-rule select-none"
                onContextMenu={(e) => e.preventDefault()}
                onTouchStart={() => startLongPress(p)}
                onTouchEnd={cancelLongPress}
                onTouchCancel={cancelLongPress}
                onMouseDown={() => startLongPress(p)}
                onMouseUp={cancelLongPress}
                onMouseLeave={cancelLongPress}
              />
              <button
                type="button"
                title="Quitar esta foto"
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red text-white flex items-center justify-center cursor-pointer"
                onClick={() => setPhotos((ps) => ps.filter((_, idx) => idx !== i))}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
        {taking ? (
          <LiveCameraCapture allowUpload folder="merchandise-outflow-photos" onCaptured={(url) => { setPhotos((p) => [...p, url]); setTaking(false); }} onCancel={() => setTaking(false)} />
        ) : photos.length >= MAX_PHOTOS ? (
          <div className="text-[11.5px] text-steel">Máximo {MAX_PHOTOS} fotos por lote. Quita alguna para agregar otra, o envía el resto en un lote aparte.</div>
        ) : (
          <button type="button" className="flex items-center gap-1.5 text-[12.5px] font-bold border-[1.5px] border-rule rounded-md px-3.5 py-2 cursor-pointer" onClick={() => setTaking(true)}>
            <Camera size={14} /> {photos.length === 0 ? "Tomar foto" : "Agregar otra foto"}
          </button>
        )}
        {photos.length > 0 && (
          <button
            type="button"
            disabled={extracting}
            className="mt-2.5 w-full flex items-center justify-center gap-1.5 rounded border border-teal bg-teal px-3 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60"
            onClick={runExtract}
          >
            <Sparkles size={14} /> {extracting ? "Leyendo…" : "Leer con IA"}
          </button>
        )}
      </div>

      {rows.length > 0 && (
        <div className="flex flex-col gap-2 mb-3">
          <div className="bg-cloud rounded-md p-2.5 text-[12px]">
            <span className="font-semibold">{rows.length} producto(s) detectado(s)</span>
            {" · "}
            {rows.reduce((sum, r) => sum + r.quantity, 0)} unidad(es) en total
            {" · "}
            {rows.filter((r) => r.selected).length} coincidieron con el catálogo
            {rows.some((r) => !r.selected && r.sourceCode) && (
              <>
                {" · "}
                <span className="text-yellow font-semibold">{rows.filter((r) => !r.selected && r.sourceCode).length} con código no reconocido</span>
              </>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-steel">Confirma cada renglón antes de agregarlo</div>
            {rows.some((r) => r.selected && !r.added) && (
              <button type="button" className="text-[11px] font-bold text-teal cursor-pointer shrink-0" onClick={addAllMatched}>
                Agregar todos los que coincidieron
              </button>
            )}
          </div>
          {rows.map((row, i) =>
            row.added ? (
              <div key={i} className="bg-green/10 border border-green/35 rounded-md p-2.5 text-[12px] flex items-center gap-1.5">
                <Check size={13} className="text-green" /> {row.selected?.name ?? row.manualName} — {row.quantity} un. agregado
              </div>
            ) : (
              <div key={i} className="bg-cloud rounded-md p-2.5">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  {row.editingName ? (
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <input
                        type="text"
                        autoFocus
                        className="flex-1 min-w-0 rounded border border-teal bg-surface px-2 py-1 text-[12.5px] font-semibold"
                        value={row.name}
                        onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setRows((rs) => rs.map((r, j) => (j === i ? { ...r, editingName: false } : r)));
                        }}
                      />
                      <button
                        type="button"
                        className="text-teal cursor-pointer shrink-0"
                        title="Listo"
                        onClick={() => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, editingName: false } : r)))}
                      >
                        <Check size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="text-[12.5px] font-semibold flex items-center gap-1.5 min-w-0">
                      <span className="truncate">
                        IA leyó: &quot;{row.name}&quot; · {row.quantity} un.
                      </span>
                      <button
                        type="button"
                        className="text-steel hover:text-teal cursor-pointer shrink-0"
                        title="Corregir el nombre que leyó la IA"
                        onClick={() => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, editingName: true } : r)))}
                      >
                        <Pencil size={12} />
                      </button>
                    </div>
                  )}
                  {row.fromCombo ? (
                    <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap bg-cloud text-steel border-rule">Del combo registrado</span>
                  ) : (
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${CONFIDENCE_STYLE[row.confidence]}`}>
                      {CONFIDENCE_LABEL[row.confidence]}
                    </span>
                  )}
                </div>
                {row.fromCombo && (
                  <div className="text-[11px] text-steel mb-1.5">
                    Desglosado del combo Dropi {row.fromCombo}.
                    {canManageJustCatalog && !row.comboBuilderOpen && (
                      <button type="button" className="ml-1.5 font-bold text-teal cursor-pointer" onClick={() => openComboCorrection(i)}>
                        ¿La receta está mal? Corregir
                      </button>
                    )}
                  </div>
                )}
                {!row.selected && row.sourceCode && (
                  <div className="text-[11.5px] bg-yellow/10 border border-yellow/35 rounded px-2 py-1.5 mb-2">
                    <div>
                      Código &quot;{row.sourceCode}&quot; no reconocido — ¿puede ser un combo nuevo?
                      {!canManageJustCatalog && " Avísale a Daniel para que lo registre en Base de datos de productos."} Mientras tanto, busca el producto a mano abajo.
                    </div>
                    {canManageJustCatalog && !row.comboBuilderOpen && (
                      <button
                        type="button"
                        className="mt-1.5 font-bold text-teal cursor-pointer"
                        onClick={() => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, comboBuilderOpen: true, comboDraft: [] } : r)))}
                      >
                        Sí, desglosar este combo ahora
                      </button>
                    )}
                  </div>
                )}
                {row.selected ? (
                  <div className="mb-2">
                    <div className="flex items-center gap-2.5 bg-green/10 border border-green/35 rounded-md p-2">
                      <div className="flex-1 min-w-0 text-[12px] font-semibold truncate">{row.selected.name}</div>
                      <button type="button" className="text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, selected: null } : r)))}>
                        Cambiar
                      </button>
                    </div>
                    {/* Confirmado 2026-08-26 (reportado por Daniel): un código a veces coincide CON CONFIANZA pero MAL contra un producto real (colisión de datos del catálogo) — se ofrece corregir/enseñar el combo real aunque ya haya un match. */}
                    {row.sourceCode && canManageJustCatalog && !row.comboBuilderOpen && (
                      <button
                        type="button"
                        className="mt-1 text-[11px] font-semibold text-steel hover:text-teal cursor-pointer"
                        onClick={() => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, comboBuilderOpen: true, comboDraft: [] } : r)))}
                      >
                        ¿El código &quot;{row.sourceCode}&quot; es en realidad un combo? Corregir
                      </button>
                    )}
                  </div>
                ) : row.manualName ? (
                  <div className="flex items-center gap-2.5 bg-surface rounded-md p-2 mb-2">
                    <div className="flex-1 min-w-0 text-[12px] font-medium truncate">{row.manualName}</div>
                    <button type="button" className="text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, manualName: "" } : r)))}>
                      Cambiar
                    </button>
                  </div>
                ) : (
                  <ProductMatchPicker
                    referencePhotoUrl={null}
                    initialQuery={row.name}
                    onConfirm={(result: ProductMatchResult) =>
                      setRows((rs) => rs.map((r, j) => (j === i ? ("catalogItem" in result ? { ...r, selected: result.catalogItem, manualName: "" } : { ...r, manualName: result.manualName, selected: null }) : r)))
                    }
                  />
                )}
                {row.comboBuilderOpen && (
                  <div className="bg-yellow/10 border border-yellow/35 rounded-md p-2.5 mb-2">
                    <div className="text-[11px] font-semibold text-steel mb-1">¿Qué productos reales trae este combo, y en qué cantidad cada uno?</div>
                    <ComboComponentBuilder components={row.comboDraft ?? []} onChange={(next) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, comboDraft: next } : r)))} />
                    <div className="flex gap-2 mt-2">
                      <button
                        type="button"
                        className="flex-1 rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer"
                        onClick={() => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, comboBuilderOpen: false } : r)))}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={row.savingCombo || !row.comboDraft?.length}
                        className="flex-1 rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-50"
                        onClick={() => (row.fromCombo ? saveComboCorrectionAndReexpand(i) : saveComboAndExpand(i))}
                      >
                        {row.savingCombo ? "Guardando…" : "Guardar combo y aplicar"}
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] text-steel">Cantidad</span>
                  <input
                    type="number"
                    min={1}
                    className="w-20 rounded border border-rule bg-surface px-2 py-1 text-[12px] font-bold"
                    value={row.quantity}
                    onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, quantity: Number(e.target.value) || 0 } : r)))}
                  />
                </div>
                <button
                  type="button"
                  disabled={row.adding || (!row.selected && !row.manualName.trim()) || row.quantity <= 0}
                  className="w-full rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-40"
                  onClick={() => addRow(i)}
                >
                  {row.adding ? "Agregando…" : "Agregar al lote"}
                </button>
              </div>
            )
          )}
        </div>
      )}

      {manualMode ? (
        <div className="bg-cloud rounded-md p-3 mb-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1.5">Agregar producto manual</div>
          {manualSelected ? (
            <div className="flex items-center gap-2.5 bg-green/10 border border-green/35 rounded-md p-2 mb-2">
              <div className="flex-1 min-w-0 text-[12px] font-semibold truncate">{manualSelected.name}</div>
              <button type="button" className="text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setManualSelected(null)}>Cambiar</button>
            </div>
          ) : manualName ? (
            <div className="flex items-center gap-2.5 bg-surface rounded-md p-2 mb-2">
              <div className="flex-1 min-w-0 text-[12px] font-medium truncate">{manualName}</div>
              <button type="button" className="text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setManualName("")}>Cambiar</button>
            </div>
          ) : (
            <ProductMatchPicker referencePhotoUrl={null} onConfirm={(r) => ("catalogItem" in r ? setManualSelected(r.catalogItem) : setManualName(r.manualName))} onCancel={() => setManualMode(false)} />
          )}
          <div className="flex items-center gap-2 mt-2 mb-2">
            <span className="text-[11px] text-steel">Cantidad</span>
            <input type="number" min={1} className="w-20 rounded border border-rule bg-surface px-2 py-1 text-[12px] font-bold" value={manualQty} onChange={(e) => setManualQty(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button type="button" className="flex-1 rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer" onClick={() => setManualMode(false)}>Cancelar</button>
            <button type="button" className="flex-1 rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer" onClick={addManual}>Agregar</button>
          </div>
        </div>
      ) : (
        <button type="button" className="w-full flex items-center justify-center gap-1.5 rounded-md border-[1.5px] border-dashed border-rule px-3.5 py-2 text-[12px] font-semibold cursor-pointer hover:border-teal mb-3" onClick={() => setManualMode(true)}>
          <Plus size={13} /> Agregar un producto sin usar la IA
        </button>
      )}

      {error && <div className="text-red text-[12px] mb-2">{error}</div>}

      {batch.items.length > 0 && !confirmingSubmit && (
        <button type="button" className="w-full flex items-center justify-center gap-1.5 rounded border border-teal bg-teal px-3.5 py-2.5 text-[13px] font-bold text-navy cursor-pointer" onClick={() => setConfirmingSubmit(true)}>
          <Send size={14} /> Enviar lote
        </button>
      )}
      {confirmingSubmit && (
        <div className="bg-surface border border-rule rounded-md p-4">
          <div className="font-display font-bold text-[14px] mb-3">¿Está bien detallada la información?</div>
          <div className="flex gap-2">
            <button type="button" className="flex-1 rounded border border-rule px-3 py-2 text-[12.5px] font-semibold cursor-pointer" onClick={() => setConfirmingSubmit(false)}>Revisar de nuevo</button>
            <button type="button" disabled={submitting} className="flex-1 rounded border border-teal bg-teal px-3 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={submitBatch}>
              {submitting ? "Enviando…" : "Sí, enviar lote"}
            </button>
          </div>
        </div>
      )}

      {zoomedPhoto && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center cursor-zoom-out p-6" onClick={() => setZoomedPhoto(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoomedPhoto} alt="" className="max-w-[90vw] max-h-[90vh] object-contain rounded-md shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
