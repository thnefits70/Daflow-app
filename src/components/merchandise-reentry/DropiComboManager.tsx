"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, PackageSearch } from "lucide-react";
import { ComboComponentBuilder, type ComboDraftComponent } from "./ComboComponentBuilder";
import { formatDateTime } from "@/lib/formatDateTime";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { useFormDraft } from "@/lib/useFormDraft";
import { ExpandableName } from "@/components/ui/ExpandableName";
import { ComboBrandInfo } from "@/components/shared/ComboBrandInfo";
import { ComboAliasConfirm, type AliasMother } from "@/components/shared/ComboAliasConfirm";

type CatalogItem = { id: string; name: string; photos: string[]; justCode: string | null };
type ComboComponent = { id: string; quantity: number; catalogItem: CatalogItem };
type Combo = { id: string; code: string; label: string | null; createdByName: string | null; createdAt: string; components: ComboComponent[]; aliasOfCode: string | null };
type ComboDraftData = { code: string; label: string; components: ComboDraftComponent[] };
function isComboDraftEmpty(d: ComboDraftData) {
  return !d.code.trim() && !d.label.trim() && d.components.length === 0;
}

// Confirmado 2026-08-26 (pedido explícito del usuario): un ID de combo de
// Dropi no es un producto real — Dropi los crea con nombres distintos por
// tema publicitario, pero adentro trae varios productos reales de Just en
// cantidades fijas. Daniel registra ese desglose UNA vez acá y Registro de
// Egresos lo aplica solo cada vez que ese código aparece en una hoja de
// despacho/garantía, sin que Daniel tenga que desglosarlo a mano cada vez.
// El buscador de productos (con foto — pedido explícito del usuario, es lo
// que de verdad confirma que es el producto correcto) se comparte con
// DocumentCaptureFlow vía ComboComponentBuilder.
export function DropiComboManager() {
  const [loading, setLoading] = useState(true);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null); // "new" o el id del combo en edición
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [components, setComponents] = useState<ComboDraftComponent[]>([]);
  const [notice, setNotice] = useState("");
  // Receta idéntica a un combo que ya existe: se confirma antes de unirlos
  // (pedido del usuario 2026-10-10).
  const [aliasMother, setAliasMother] = useState<AliasMother | null>(null);
  // Pedido del usuario 2026-10-10: la receta se registra una sola vez, con
  // doble confirmación (resumen antes de guardar); después solo el admin la
  // corrige o borra el combo.
  const [reviewing, setReviewing] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Confirmado 2026-09-16, pedido explícito del usuario: los combos se
  // suben a Dropi, así que mientras se arman acá (antes de guardar nada) se
  // ve en vivo el Precio Dropi calculado con el costo real de cada
  // producto — nunca se guarda, es solo vista previa. Si a algún producto
  // le falta el costo, se avisa explícito en vez de callarlo.
  const [dropiPreview, setDropiPreview] = useState<{ dropiPrice: number | null; missingCostItemIds: string[] } | null>(null);
  const [loadingDropiPreview, setLoadingDropiPreview] = useState(false);

  function loadDropiPreview() {
    if (components.length === 0) {
      setDropiPreview(null);
      return;
    }
    setLoadingDropiPreview(true);
    fetch("/api/dropi-combos/price-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ components: components.map((c) => ({ catalogItemId: c.catalogItem.id, quantity: c.quantity })) }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(setDropiPreview)
      .catch(() => setDropiPreview(null))
      .finally(() => setLoadingDropiPreview(false));
  }

  useEffect(() => {
    const t = setTimeout(loadDropiPreview, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [components]);

  // Guardado automático: si sale a revisar otra cosa antes de terminar de
  // registrar/editar este combo, al volver encuentra código/nombre/productos
  // tal como los había dejado. Solo activo mientras el formulario está
  // abierto (editingId !== null) — al cerrarlo no hay nada que respaldar.
  const draftKey = editingId ? `dropiCombo:${editingId}` : null;
  const { clearDraft } = useFormDraft<ComboDraftData>(
    draftKey,
    { code, label, components },
    (d) => {
      setCode(d.code);
      setLabel(d.label);
      setComponents(d.components);
    },
    isComboDraftEmpty,
    "Combo sin terminar de registrar",
    "/area/workspace?tab=reingreso"
  );

  function load() {
    fetch("/api/dropi-combos")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setCombos(data ?? []))
      .catch(() => setCombos([]))
      .finally(() => setLoading(false));
    fetch("/api/dropi-combos/permissions")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCanEdit(!!d?.canEdit))
      .catch(() => setCanEdit(false));
  }

  useEffect(load, []);

  function startCreate() {
    setEditingId("new");
    setCode("");
    setLabel("");
    setComponents([]);
    setErr("");
    setNotice("");
  }

  function startEdit(combo: Combo) {
    if (combo.aliasOfCode) {
      setNotice(`El ${combo.code} es un ID alterno del combo ${combo.aliasOfCode} — para cambiar su receta, edita el ${combo.aliasOfCode}.`);
      return;
    }
    setNotice("");
    setEditingId(combo.id);
    setCode(combo.code);
    setLabel(combo.label ?? "");
    setComponents(combo.components.map((c) => ({ catalogItem: { ...c.catalogItem, pendingRegistration: false }, quantity: c.quantity })));
    setErr("");
  }

  function cancelForm() {
    clearDraft();
    setEditingId(null);
    setAliasMother(null);
    setReviewing(false);
    setErr("");
  }

  // Primer clic: revisa los datos y muestra el resumen (doble confirmación).
  function review() {
    if (!code.trim()) return setErr("Falta el código del combo.");
    if (components.length === 0) return setErr("Agrega al menos un producto real.");
    if (components.some((c) => c.quantity <= 0)) return setErr("Las cantidades deben ser mayores a 0.");
    setErr("");
    setReviewing(true);
  }

  async function save(confirmAlias = false) {
    if (!editingId) return;
    setSaving(true);
    setErr("");
    const body = {
      code: code.trim(),
      label: label.trim() || undefined,
      confirmAlias: editingId === "new" ? confirmAlias : undefined,
      components: components.map((c) => ({ catalogItemId: c.catalogItem.id, quantity: c.quantity })),
    };
    const res = await fetch(editingId === "new" ? "/api/dropi-combos" : `/api/dropi-combos/${editingId}`, {
      method: editingId === "new" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (res.status === 409 && json?.needsAliasConfirm) {
      setAliasMother(json.mother as AliasMother);
      setSaving(false);
      return;
    }
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo guardar el combo.");
      setAliasMother(null);
      setReviewing(false);
      setSaving(false);
      return;
    }
    setSaving(false);
    setAliasMother(null);
    setReviewing(false);
    clearDraft();
    setEditingId(null);
    setNotice(json?.aliasOfCode ? `Listo: el ${json.code} quedó unido al combo ${json.aliasOfCode} y lleva su marca.` : "");
    load();
  }

  async function deleteCombo(id: string) {
    const res = await fetch(`/api/dropi-combos/${id}`, { method: "DELETE" });
    const json = await res.json().catch(() => null);
    setNotice(res.ok ? "" : json?.error ?? "No se pudo eliminar el combo.");
    setConfirmDeleteId(null);
    load();
  }

  if (loading) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[12.5px] font-bold flex items-center gap-1.5">
          <PackageSearch size={14} className="text-teal" /> Combos de Dropi
        </div>
        {editingId === null && (
          <button type="button" className="flex items-center gap-1 text-[11.5px] font-bold text-teal cursor-pointer" onClick={startCreate}>
            <Plus size={13} /> Registrar combo
          </button>
        )}
      </div>
      <div className="text-[12px] text-steel mb-3">
        Un ID de combo de Dropi no es un producto real — por dentro trae varios productos distintos del catálogo. Registra acá cómo se desglosa cada combo (qué
        productos reales y en qué cantidad) para que Registro de Egresos lo reconozca solo al leer una hoja de despacho/garantía. La receta se registra una sola vez:
        si después ves un error, avísale al administrador — solo él puede corregirla.
      </div>

      {notice && <div className="text-[12px] text-gold mb-2">{notice}</div>}

      {editingId !== null && (
        <div className="bg-cloud rounded-md p-3.5 mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-1">{editingId === "new" ? "Nuevo combo" : "Editar combo"}</div>
          {err && <div className="text-red text-[12px] mb-2">{err}</div>}
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              placeholder="Código del combo (Dropi)"
              className="flex-1 rounded border border-rule bg-surface px-2.5 py-2 text-[12.5px]"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <input
              type="text"
              placeholder="Nombre de referencia (opcional)"
              className="flex-1 rounded border border-rule bg-surface px-2.5 py-2 text-[12.5px]"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          {editingId === "new" && (
            <div className="mb-2">
              <ComboBrandInfo brand={null} />
            </div>
          )}

          <ComboComponentBuilder components={components} onChange={setComponents} />

          {components.length > 0 && (
            <div className="mt-2.5 text-[12px]">
              {loadingDropiPreview ? (
                <span className="text-steel">Calculando Precio Dropi…</span>
              ) : dropiPreview?.missingCostItemIds.length ? (
                <span className="text-red">
                  ⚠ No se puede calcular el Precio Dropi — a{" "}
                  {dropiPreview.missingCostItemIds
                    .map((id) => components.find((c) => c.catalogItem.id === id)?.catalogItem.name ?? id)
                    .join(", ")}{" "}
                  le falta el costo registrado.
                </span>
              ) : dropiPreview?.dropiPrice != null ? (
                <span className="font-semibold text-ink">
                  Precio Dropi estimado: <span className="text-teal font-bold">${dropiPreview.dropiPrice.toFixed(2)}</span> (20% de margen, incluye fulfillment $0.75)
                </span>
              ) : null}
            </div>
          )}

          {aliasMother ? (
            <div className="mt-3">
              <ComboAliasConfirm
                newCode={code.trim()}
                mother={aliasMother}
                busy={saving}
                onConfirm={() => save(true)}
                onReject={() => {
                  setAliasMother(null);
                  setReviewing(false);
                }}
              />
            </div>
          ) : reviewing ? (
            <div className="mt-3 rounded-md border border-gold/60 bg-surface p-3">
              <div className="text-[12px] font-bold mb-1.5">Revisa antes de guardar</div>
              <div className="text-[11.5px] mb-1">
                Código: <span className="font-mono font-semibold">{code.trim()}</span>
                {label.trim() && <span> — {label.trim()}</span>}
              </div>
              {editingId === "new" && (
                <div className="mb-2">
                  <ComboBrandInfo brand={null} />
                </div>
              )}
              <div className="flex flex-col gap-1 mb-2.5">
                {components.map((c) => (
                  <div key={c.catalogItem.id} className="flex items-center gap-2 text-[11.5px]">
                    <span className="font-mono font-bold text-teal shrink-0">{c.quantity}×</span>
                    <CatalogCode code={c.catalogItem.justCode} />
                    <ExpandableName text={c.catalogItem.name} className="flex-1" />
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-steel mb-2.5">
                Confirma que estos son los productos reales y las cantidades correctas. {canEdit ? "" : "Después de guardar, solo el administrador podrá cambiar esta receta."}
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={saving} className="flex-1 rounded border border-teal bg-teal px-3 py-2 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={() => save()}>
                  {saving ? "Guardando…" : "Sí, guardar receta"}
                </button>
                <button type="button" disabled={saving} className="flex-1 rounded border border-rule px-3 py-2 text-[12px] font-semibold cursor-pointer" onClick={() => setReviewing(false)}>
                  Corregir
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 mt-3">
              <button type="button" className="flex-1 rounded border border-rule px-3 py-2 text-[12px] font-semibold cursor-pointer" onClick={cancelForm}>
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                className="flex-1 rounded border border-teal bg-teal px-3 py-2 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60"
                onClick={review}
              >
                Continuar
              </button>
            </div>
          )}
        </div>
      )}

      {combos.length === 0 ? (
        <div className="text-[12px] text-steel">Todavía no hay combos registrados.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {combos.map((combo) => (
            <div key={combo.id} className="bg-surface border border-rule rounded-md p-3">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-[11.5px] font-bold text-teal shrink-0">{combo.code}</span>
                  {combo.label && <ExpandableName text={combo.label} className="text-[12px] text-steel" />}
                  {combo.aliasOfCode && <span className="text-[10.5px] font-bold text-gold shrink-0">ID alterno de {combo.aliasOfCode}</span>}
                </div>
                {canEdit && (
                <div className="flex items-center gap-2.5 shrink-0">
                  <button type="button" className="text-steel hover:text-teal cursor-pointer" title="Editar" onClick={() => startEdit(combo)}>
                    <Pencil size={13} />
                  </button>
                  {confirmDeleteId === combo.id ? (
                    <div className="flex items-center gap-1.5">
                      <button type="button" className="text-[11px] font-semibold cursor-pointer" onClick={() => setConfirmDeleteId(null)}>
                        Cancelar
                      </button>
                      <button type="button" className="text-[11px] font-bold text-red cursor-pointer" onClick={() => deleteCombo(combo.id)}>
                        Sí, eliminar
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="text-steel hover:text-red cursor-pointer" title="Eliminar" onClick={() => setConfirmDeleteId(combo.id)}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {combo.components.map((c) => (
                  <span key={c.id} className="font-mono text-[10.5px] bg-cloud rounded-full px-2 py-0.5 inline-flex items-center gap-1">
                    {c.quantity}× <CatalogCode code={c.catalogItem.justCode} /> {c.catalogItem.name}
                  </span>
                ))}
              </div>
              <div className="text-[10px] text-steel mt-1.5">
                Registrado por {combo.createdByName ?? "—"} · {formatDateTime(combo.createdAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
