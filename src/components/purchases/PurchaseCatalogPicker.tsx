"use client";

import { useEffect, useState } from "react";
import { Search, Plus, Camera, AlertTriangle, CheckCircle2, Trash2, Flag, X, Clock } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";
import { CompleteCatalogRegistration } from "@/components/shared/CompleteCatalogRegistration";
import { CatalogCode } from "@/components/shared/CatalogCode";

// Confirmado 2026-08-14: bug real reportado por Bryan — mientras se está
// "creando" un producto nuevo (nombre, fotos, descripción, código), todo eso
// vivía SOLO como estado interno de este componente y nunca llegaba al
// padre hasta el clic final en "Guardar". Si la persona salía de la página
// a medias (aunque tuviera nombre y fotos ya cargadas y visibles en
// pantalla), el borrador de PurchaseRequestForm no tenía nada que guardar —
// no es que se "perdiera" al restaurar, es que nunca se llegó a capturar.
// Mismo patrón ya usado para `productQuery`/`onQueryChange`, extendido para
// cubrir también este sub-formulario.
export type CatalogCreateDraft = { creating: boolean; newName: string; newDescription: string; newCode: string; photos: string[] };

export type CatalogItemDTO = {
  id: string;
  name: string;
  photos: string[];
  description?: string | null;
  code?: string | null;
  justCode?: string | null;
  pendingRegistration?: boolean;
  canDelete?: boolean;
  canRequestDelete?: boolean;
  hasPendingDelete?: boolean;
  pendingDeleteRequest?: { id: string; reason: string | null; requestedByName: string | null } | null;
};

// Confirmado 2026-07-30 (boceto aprobado): un nombre por insumo, siempre. El
// match EXACTO bloquea directo (obliga a seleccionar el existente); el
// parecido-pero-no-idéntico solo avisa vía IA — la persona decide.
export function PurchaseCatalogPicker({
  value,
  onChange,
  isAdmin = false,
  defaultQuery = "",
  onQueryChange,
  defaultCreateDraft = null,
  onCreateDraftChange,
}: {
  value: CatalogItemDTO | null;
  onChange: (item: CatalogItemDTO | null) => void;
  isAdmin?: boolean;
  // Confirmado 2026-08-03: mientras la persona todavía está escribiendo el
  // nombre (antes de seleccionar o crear el insumo), ese texto vivía solo
  // como estado interno de este componente y se perdía al restaurar un
  // borrador — ahora el padre lo puede guardar y devolver como valor inicial.
  defaultQuery?: string;
  onQueryChange?: (query: string) => void;
  // Mismo mecanismo que defaultQuery/onQueryChange, para el sub-formulario
  // de "crear producto nuevo" — ver el comentario en CatalogCreateDraft.
  defaultCreateDraft?: CatalogCreateDraft | null;
  onCreateDraftChange?: (draft: CatalogCreateDraft) => void;
}) {
  const [query, setQuery] = useState(defaultQuery);
  const [results, setResults] = useState<CatalogItemDTO[]>([]);
  const [open, setOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [requestingDeleteId, setRequestingDeleteId] = useState<string | null>(null);
  const [requestDeleteReason, setRequestDeleteReason] = useState("");
  const [requestDeleteBusy, setRequestDeleteBusy] = useState(false);
  const [requestedDeleteIds, setRequestedDeleteIds] = useState<string[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [completingItem, setCompletingItem] = useState<CatalogItemDTO | null>(null);

  const [creating, setCreating] = useState(defaultCreateDraft?.creating ?? false);
  const [newName, setNewName] = useState(defaultCreateDraft?.newName ?? "");
  const [newDescription, setNewDescription] = useState(defaultCreateDraft?.newDescription ?? "");
  const [newCode, setNewCode] = useState(defaultCreateDraft?.newCode ?? "");
  const [photos, setPhotos] = useState<string[]>(defaultCreateDraft?.photos ?? []);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const { onPaste: onPastePhoto, onMouseEnter: onPasteHoverIn, onMouseLeave: onPasteHoverOut } = usePasteFile((file) => addPhoto(file));
  const [similarity, setSimilarity] = useState<{ suspected: boolean; matchedName: string | null; message: string | null } | null>(null);
  const [checkingSimilarity, setCheckingSimilarity] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Reporta al padre en cada cambio — así el borrador de PurchaseRequestForm
  // ya no se queda ciego mientras alguien está a medio crear un producto
  // nuevo (ver comentario en CatalogCreateDraft).
  useEffect(() => {
    onCreateDraftChange?.({ creating, newName, newDescription, newCode, photos });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating, newName, newDescription, newCode, photos]);

  function resetCreateForm() {
    setCreating(false);
    setNewName("");
    setNewDescription("");
    setNewCode("");
    setPhotos([]);
    setSimilarity(null);
    setConfirmStep(false);
    setErr("");
  }

  useEffect(() => {
    if (value) return;
    let active = true;
    fetch("/api/purchase-catalog")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: CatalogItemDTO[]) => {
        if (active) setResults(data);
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, [value]);

  const filtered = query.trim()
    ? results.filter((r) => {
        const q = query.trim().toLowerCase();
        return r.name.toLowerCase().includes(q) || (!!r.justCode && r.justCode.toLowerCase().includes(q));
      })
    : results;

  async function startCreate() {
    setCreating(true);
    setNewName(query);
    setNewDescription("");
    setNewCode("");
    setPhotos([]);
    setSimilarity(null);
    setConfirmStep(false);
    setErr("");
  }

  async function addPhoto(file: File) {
    if (photos.length >= 3) return;
    setUploadingPhoto(true);
    setErr("");
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-catalog");
    setUploadingPhoto(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setPhotos((p) => [...p, uploaded.url]);
  }

  async function goToConfirm() {
    if (!newName.trim()) {
      setErr("Escribe el nombre del producto, mercadería o insumo.");
      return;
    }
    if (photos.length < 3) {
      setErr("Agrega mínimo 3 fotos del producto.");
      return;
    }
    if (uploadingPhoto) {
      setErr("Espera a que termine de subir la foto.");
      return;
    }
    setErr("");
    setCheckingSimilarity(true);
    // Confirmado 2026-08-14: bug real reportado por Bryan — un corte de red o
    // que el servidor tarde de más dejaba este fetch sin resolver nunca, y el
    // botón quedaba trabado en "Revisando…" para siempre, sin aviso y sin
    // forma de reintentar. Ahora cualquier falla se avisa y se puede
    // reintentar — nunca se queda pegado.
    let res: Response;
    try {
      res = await fetch("/api/purchase-catalog/check-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
    } catch {
      setCheckingSimilarity(false);
      setErr("No se pudo verificar el nombre — revisa tu conexión e intenta de nuevo.");
      return;
    }
    setCheckingSimilarity(false);
    if (!res.ok) {
      setErr("No se pudo verificar el nombre — intenta de nuevo.");
      return;
    }
    const data = await res.json().catch(() => null);
    if (data?.exactMatch) {
      setErr(`Ya existe "${data.exactMatch.name}" — selecciónalo de la lista en vez de crear uno nuevo.`);
      setCreating(false);
      onChange({ id: data.exactMatch.id, name: data.exactMatch.name, photos: [] });
      return;
    }
    setSimilarity(data?.similarity ?? null);
    setConfirmStep(true);
  }

  async function saveNew() {
    setBusy(true);
    setErr("");
    let res: Response;
    try {
      res = await fetch("/api/purchase-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), photos, description: newDescription.trim() || undefined, code: newCode.trim() || undefined }),
      });
    } catch {
      setBusy(false);
      setErr("No se pudo guardar — revisa tu conexión e intenta de nuevo.");
      return;
    }
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo crear el producto, mercadería o insumo.");
      return;
    }
    setCreating(false);
    onChange(data);
  }

  // Confirmado 2026-08-03/06: admin siempre puede eliminar; quien creó el
  // insumo puede eliminarlo él mismo solo dentro de las primeras 2 horas y
  // sin compras registradas (`canDelete`, calculado server-side) — con
  // confirmación siempre, para no borrar algo por accidente. El servidor
  // igual vuelve a bloquear si el insumo ya tiene compras registradas.
  async function deleteItem(item: CatalogItemDTO, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`¿Eliminar "${item.name}" del catálogo? Esta acción no se puede deshacer.`)) return;
    setDeletingId(item.id);
    setDeleteErr(null);
    const res = await fetch(`/api/purchase-catalog/${item.id}`, { method: "DELETE" });
    setDeletingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setDeleteErr(`"${item.name}" — ${data?.error ?? "No se pudo eliminar."}`);
      return;
    }
    setResults((rs) => rs.filter((r) => r.id !== item.id));
  }

  // Confirmado 2026-08-06: si ya pasaron las 2 horas (o el insumo ya tiene
  // compras) quien lo creó no puede borrarlo directo — puede pedirle al
  // admin que lo borre, con una razón breve. Reutiliza el mismo modelo
  // PurchaseCatalogItemDeleteRequest que ya existía en el schema.
  async function requestDelete(item: CatalogItemDTO, e: React.MouseEvent) {
    e.stopPropagation();
    setRequestDeleteBusy(true);
    setDeleteErr(null);
    const res = await fetch(`/api/purchase-catalog/${item.id}/delete-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: requestDeleteReason.trim() || undefined }),
    });
    setRequestDeleteBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setDeleteErr(`"${item.name}" — ${data?.error ?? "No se pudo enviar la solicitud."}`);
      return;
    }
    setRequestedDeleteIds((ids) => [...ids, item.id]);
    setRequestingDeleteId(null);
    setRequestDeleteReason("");
  }

  // Revisión del admin sobre una solicitud de borrado pendiente — aprobar
  // borra de verdad (el servidor vuelve a chequear que no tenga compras);
  // rechazar solo descarta la solicitud, sin tocar el producto.
  async function reviewDeleteRequest(item: CatalogItemDTO, action: "approve" | "reject", e: React.MouseEvent) {
    e.stopPropagation();
    if (!item.pendingDeleteRequest) return;
    setReviewingId(item.id);
    setDeleteErr(null);
    const res = await fetch(`/api/purchase-catalog/delete-requests/${item.pendingDeleteRequest.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setReviewingId(null);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setDeleteErr(`"${item.name}" — ${data?.error ?? "No se pudo procesar la solicitud."}`);
      return;
    }
    if (data?.deleted) {
      setResults((rs) => rs.filter((r) => r.id !== item.id));
    } else {
      setResults((rs) => rs.map((r) => (r.id === item.id ? { ...r, hasPendingDelete: false, pendingDeleteRequest: null } : r)));
    }
  }

  if (value) {
    return (
      <div className="flex items-center gap-2.5 bg-cloud border border-rule rounded-md px-3 py-2.5">
        {value.photos[0] && <img src={value.photos[0]} alt="" className="w-9 h-9 rounded object-cover shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold flex items-center gap-1.5">
            <CatalogCode code={value.justCode} />
            <span>{value.name}</span>
          </div>
          {value.description && <div className="text-[11px] text-steel truncate">{value.description}</div>}
        </div>
        <button type="button" className="text-[11.5px] text-blue font-semibold cursor-pointer" onClick={() => onChange(null)}>
          Cambiar
        </button>
      </div>
    );
  }

  if (creating) {
    return (
      <div className="bg-surface2 border border-rule rounded-md p-3.5">
        {!confirmStep ? (
          <>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Nombre del producto, mercadería o insumo nuevo</label>
            <input
              className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px] mb-3"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ej. Rollos de cinta roja"
            />
            <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Fotos (mínimo 3)</label>
            <div className="flex gap-2 mb-3">
              {photos.map((p, i) => (
                <div key={i} className="relative">
                  <img src={p} alt="" className="w-16 h-16 rounded object-cover border border-rule" />
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
              {photos.length < 3 && (
                <label
                  tabIndex={0}
                  onPaste={onPastePhoto}
                  onMouseEnter={onPasteHoverIn}
                  onMouseLeave={onPasteHoverOut}
                  title="Pasa el mouse y Ctrl+V para pegar una foto copiada"
                  className="w-16 h-16 rounded border-[1.5px] border-dashed border-rule flex items-center justify-center cursor-pointer text-steel hover:border-teal focus:border-teal focus:outline-none"
                >
                  {uploadingPhoto ? (
                    <span className="w-4 h-4 rounded-full border-2 border-rule border-t-teal animate-spin" />
                  ) : (
                    <Camera size={18} />
                  )}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && addPhoto(e.target.files[0])} />
                </label>
              )}
            </div>
            <div className="text-[11px] text-steel mb-3">
              Real si lo tienes físicamente; referencial del proveedor (misma foto de la cotización) si no — que se vea el producto exacto.
            </div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
              Descripción <span className="text-steel-dim normal-case font-normal">(opcional)</span>
            </label>
            <textarea
              rows={2}
              className="w-full rounded border border-rule px-2.5 py-2 text-[13px] mb-3"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Ej. Qué es o para qué sirve este producto — ayuda a identificarlo"
            />
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
              Código del proveedor <span className="text-steel-dim normal-case font-normal">(opcional — si lo tienes a la mano)</span>
            </label>
            <input
              className="w-full rounded border border-rule px-2.5 py-2 text-[13px] mb-3"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="Ej. REF-4471 — si la cotización trae un código en vez de nombre"
            />
            {err && <div className="text-red text-[12px] mb-2.5">{err}</div>}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                disabled={checkingSimilarity || uploadingPhoto}
                className="rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
                onClick={goToConfirm}
              >
                {checkingSimilarity ? "Revisando…" : "Continuar"}
              </button>
              <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={resetCreateForm}>
                Cancelar
              </button>
            </div>
          </>
        ) : (
          <>
            {similarity?.suspected && (
              <div className="flex items-start gap-2 bg-gold/10 border border-gold/30 rounded-md p-3 mb-3 text-[12.5px]" style={{ color: "#D9A441" }}>
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span className="text-ink">{similarity.message}</span>
              </div>
            )}
            <div className="bg-cloud border border-rule rounded-md p-3 mb-3">
              <div className="text-[13px] font-semibold mb-1">{newName}</div>
              {newDescription.trim() && <div className="text-[12px] text-steel mb-2">{newDescription.trim()}</div>}
              <div className="flex gap-1.5">
                {photos.map((p, i) => (
                  <img key={i} src={p} alt="" className="w-12 h-12 rounded object-cover" />
                ))}
              </div>
            </div>
            <div className="text-[11.5px] text-ink mb-3">
              <b>¿Verificaste que todos los detalles están escritos correctamente?</b> — no se puede corregir un error de tipeo sin pedirle autorización al administrador.
            </div>
            {err && <div className="text-red text-[12px] mb-2.5">{err}</div>}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                disabled={busy}
                className="rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60"
                onClick={saveNew}
              >
                Guardar
              </button>
              <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={() => setConfirmStep(false)}>
                Atrás
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel" />
        <input
          className="w-full rounded border border-rule pl-8.5 pr-3 py-2 text-[13.5px]"
          placeholder="Buscar o crear producto, mercadería o insumo"
          value={query}
          onChange={(e) => { setQuery(e.target.value); onQueryChange?.(e.target.value); setOpen(true); }}
          onFocus={() => { if (query.trim()) setOpen(true); }}
        />
      </div>
      {open && query.trim() && (
        <div className="mt-1.5 bg-surface2 border border-rule rounded-md overflow-hidden max-h-56 overflow-y-auto">
          {deleteErr && (
            <div className="flex items-start justify-between gap-2 px-3 py-2 text-[11.5px] text-red border-b border-rule bg-red/5">
              <span>{deleteErr}</span>
              <button type="button" className="shrink-0 font-semibold underline cursor-pointer" onClick={() => setDeleteErr(null)}>
                Entendido, no se borra
              </button>
            </div>
          )}
          {filtered.map((item) => {
            const alreadyRequested = requestedDeleteIds.includes(item.id) || (!!item.hasPendingDelete && !isAdmin);
            return (
              <div key={item.id} className="border-b border-rule last:border-none">
                <div className="flex items-center">
                  <button
                    type="button"
                    className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-cloud cursor-pointer"
                    onClick={() => {
                      if (item.pendingRegistration) {
                        setCompletingItem(item);
                        return;
                      }
                      onChange(item);
                      setOpen(false);
                    }}
                  >
                    {item.pendingRegistration ? (
                      <Clock size={13} className="text-gold shrink-0" style={{ color: "#D9A441" }} />
                    ) : (
                      <CheckCircle2 size={13} className="text-teal shrink-0" />
                    )}
                    <CatalogCode code={item.justCode} />
                    <span className="truncate">{item.name}</span>
                    {item.pendingRegistration && (
                      <span className="shrink-0 font-mono text-[9px] font-bold uppercase rounded-full px-1.5 py-0.5 bg-gold/15 border border-gold/40" style={{ color: "#D9A441" }}>
                        Sin fotos — matricular
                      </span>
                    )}
                  </button>
                  {item.canDelete && (
                    <button
                      type="button"
                      title={isAdmin ? "Eliminar" : "Eliminar — solo puedes borrar lo que tú creaste, dentro de las primeras 2 horas y sin compras registradas"}
                      disabled={deletingId === item.id}
                      className="px-2.5 py-2 text-steel hover:text-red cursor-pointer disabled:opacity-50 shrink-0"
                      onClick={(e) => deleteItem(item, e)}
                    >
                      {deletingId === item.id ? <span className="block w-3.5 h-3.5 rounded-full border-2 border-rule border-t-red animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  )}
                  {!item.canDelete && item.canRequestDelete && !alreadyRequested && (
                    <button
                      type="button"
                      title="Ya pasaron 2 horas (o tiene compras registradas) — pídele al admin que lo borre"
                      className="px-2.5 py-2 text-steel hover:text-gold cursor-pointer shrink-0"
                      onClick={(e) => { e.stopPropagation(); setRequestingDeleteId(item.id); setRequestDeleteReason(""); }}
                    >
                      <Flag size={13} />
                    </button>
                  )}
                  {!item.canDelete && alreadyRequested && (
                    <span className="px-2.5 text-[10px] text-steel shrink-0">Solicitud enviada</span>
                  )}
                </div>

                {requestingDeleteId === item.id && (
                  <div className="px-3 pb-2.5">
                    <textarea
                      className="w-full rounded border border-rule px-2.5 py-1.5 text-[11.5px] mb-1.5"
                      rows={2}
                      placeholder="¿Por qué hace falta borrarlo? (opcional)"
                      value={requestDeleteReason}
                      onChange={(e) => setRequestDeleteReason(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={requestDeleteBusy}
                        className="rounded border border-gold/50 px-2.5 py-1 text-[11px] font-semibold cursor-pointer disabled:opacity-60"
                        style={{ color: "#D9A441" }}
                        onClick={(e) => requestDelete(item, e)}
                      >
                        Pedirle al admin que lo borre
                      </button>
                      <button type="button" className="text-steel text-[11px] cursor-pointer" onClick={(e) => { e.stopPropagation(); setRequestingDeleteId(null); }}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {isAdmin && item.pendingDeleteRequest && (
                  <div className="px-3 pb-2.5">
                    <div className="flex items-start justify-between gap-2 bg-gold/10 border border-gold/35 rounded-md px-2.5 py-2 text-[11px]" style={{ color: "#D9A441" }}>
                      <div>
                        <div className="font-semibold">Solicitud de borrado — {item.pendingDeleteRequest.requestedByName}</div>
                        {item.pendingDeleteRequest.reason && <div className="text-steel mt-0.5">&quot;{item.pendingDeleteRequest.reason}&quot;</div>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={reviewingId === item.id}
                          className="text-green font-semibold cursor-pointer disabled:opacity-60"
                          onClick={(e) => reviewDeleteRequest(item, "approve", e)}
                        >
                          Aprobar
                        </button>
                        <button
                          type="button"
                          disabled={reviewingId === item.id}
                          className="text-steel font-semibold cursor-pointer disabled:opacity-60"
                          onClick={(e) => reviewDeleteRequest(item, "reject", e)}
                        >
                          Rechazar
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] text-blue font-semibold hover:bg-cloud cursor-pointer"
            onClick={startCreate}
          >
            <Plus size={13} /> Crear {query.trim() ? `"${query.trim()}"` : "producto, mercadería o insumo nuevo"} — solo si de verdad es distinto
          </button>
        </div>
      )}
      {completingItem && (
        <CompleteCatalogRegistration
          item={completingItem}
          onCancel={() => setCompletingItem(null)}
          onDone={(updated) => {
            setCompletingItem(null);
            setResults((rs) => rs.map((r) => (r.id === updated.id ? { ...r, ...updated, pendingRegistration: false } : r)));
            onChange({ ...updated, pendingRegistration: false });
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
