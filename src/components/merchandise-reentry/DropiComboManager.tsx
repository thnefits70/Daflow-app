"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, PackageSearch } from "lucide-react";
import { ComboComponentBuilder, type ComboDraftComponent } from "./ComboComponentBuilder";
import { formatDateTime } from "@/lib/formatDateTime";
import { CatalogCode } from "@/components/shared/CatalogCode";

type CatalogItem = { id: string; name: string; photos: string[]; justCode: string | null };
type ComboComponent = { id: string; quantity: number; catalogItem: CatalogItem };
type Combo = { id: string; code: string; label: string | null; createdByName: string | null; createdAt: string; components: ComboComponent[] };

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
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function load() {
    fetch("/api/dropi-combos")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setCombos(data ?? []))
      .catch(() => setCombos([]))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function startCreate() {
    setEditingId("new");
    setCode("");
    setLabel("");
    setComponents([]);
    setErr("");
  }

  function startEdit(combo: Combo) {
    setEditingId(combo.id);
    setCode(combo.code);
    setLabel(combo.label ?? "");
    setComponents(combo.components.map((c) => ({ catalogItem: { ...c.catalogItem, pendingRegistration: false }, quantity: c.quantity })));
    setErr("");
  }

  function cancelForm() {
    setEditingId(null);
    setErr("");
  }

  async function save() {
    if (!editingId) return;
    if (!code.trim()) return setErr("Falta el código del combo.");
    if (components.length === 0) return setErr("Agrega al menos un producto real.");
    if (components.some((c) => c.quantity <= 0)) return setErr("Las cantidades deben ser mayores a 0.");
    setSaving(true);
    setErr("");
    const body = {
      code: code.trim(),
      label: label.trim() || undefined,
      components: components.map((c) => ({ catalogItemId: c.catalogItem.id, quantity: c.quantity })),
    };
    const res = await fetch(editingId === "new" ? "/api/dropi-combos" : `/api/dropi-combos/${editingId}`, {
      method: editingId === "new" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo guardar el combo.");
      setSaving(false);
      return;
    }
    setSaving(false);
    setEditingId(null);
    load();
  }

  async function deleteCombo(id: string) {
    await fetch(`/api/dropi-combos/${id}`, { method: "DELETE" });
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
        Un ID de combo de Dropi no es un producto real — por dentro trae varios productos de Just distintos. Registra acá cómo se desglosa cada combo (qué
        productos reales y en qué cantidad) para que Registro de Egresos lo reconozca solo al leer una hoja de despacho/garantía.
      </div>

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

          <ComboComponentBuilder components={components} onChange={setComponents} />

          <div className="flex gap-2 mt-3">
            <button type="button" className="flex-1 rounded border border-rule px-3 py-2 text-[12px] font-semibold cursor-pointer" onClick={cancelForm}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
              className="flex-1 rounded border border-teal bg-teal px-3 py-2 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60"
              onClick={save}
            >
              {saving ? "Guardando…" : "Guardar combo"}
            </button>
          </div>
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
                  {combo.label && <span className="text-[12px] text-steel truncate">{combo.label}</span>}
                </div>
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
