"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, MessageCircle, MapPin, Tag, Check, X, Search } from "lucide-react";
import { LocationPicker } from "./LocationPicker";

export type SupplierContactDTO = { id?: string; label: string; whatsapp: string };
export type SupplierDTO = {
  id: string;
  name: string;
  location: string | null;
  locationLat: number | null;
  locationLng: number | null;
  category: string | null;
  notes: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectReason: string | null;
  createdByName: string | null;
  approvedByName: string | null;
  createdAt: string;
  contacts: SupplierContactDTO[];
};

function waLink(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  return `https://wa.me/${digits}`;
}

function mapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

const DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");

function normalize(text: string) {
  return text.toLowerCase().normalize("NFD").replace(DIACRITICS_RE, "");
}

// Ranks by how well a supplier matches the search — never hides anyone, just
// reorders so the most likely match rises to the top. Notes carries the most
// weight after category since that's meant to hold the full product
// description (e.g. copied from a Telegram chat with the supplier), so it's
// usually the richest source of matches for a specific product search.
function relevanceScore(s: SupplierDTO, query: string) {
  const q = normalize(query.trim());
  if (!q) return 0;
  const words = q.split(/\s+/).filter(Boolean);
  const fields: [string, number][] = [
    [normalize(s.category ?? ""), 3],
    [normalize(s.notes ?? ""), 2],
    [normalize(s.name), 1],
  ];
  let score = 0;
  for (const [text, weight] of fields) {
    for (const w of words) {
      if (text.includes(w)) score += weight;
    }
    if (words.length > 1 && text.includes(q)) score += weight * 2;
  }
  return score;
}

const emptyForm = {
  name: "",
  location: "",
  locationLat: null as number | null,
  locationLng: null as number | null,
  category: "",
  notes: "",
  contacts: [{ label: "", whatsapp: "" }],
};

export function SuppliersPanel({
  suppliers,
  pending,
  canAdd,
  canReview,
  isAdmin,
}: {
  suppliers: SupplierDTO[];
  pending: SupplierDTO[];
  canAdd: boolean;
  canReview: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"directorio" | "pendientes">("directorio");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [query, setQuery] = useState("");

  const sortedSuppliers = useMemo(() => {
    if (!query.trim()) return suppliers;
    return [...suppliers].sort((a, b) => relevanceScore(b, query) - relevanceScore(a, query));
  }, [suppliers, query]);

  const startNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
    setErr("");
  };

  const startEdit = (s: SupplierDTO) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      location: s.location ?? "",
      locationLat: s.locationLat,
      locationLng: s.locationLng,
      category: s.category ?? "",
      notes: s.notes ?? "",
      contacts: s.contacts.length ? s.contacts.map((c) => ({ label: c.label, whatsapp: c.whatsapp })) : [{ label: "", whatsapp: "" }],
    });
    setFormOpen(true);
    setErr("");
  };

  const updateContact = (idx: number, field: "label" | "whatsapp", value: string) => {
    setForm((f) => ({ ...f, contacts: f.contacts.map((c, i) => (i === idx ? { ...c, [field]: value } : c)) }));
  };
  const addContactRow = () => setForm((f) => ({ ...f, contacts: [...f.contacts, { label: "", whatsapp: "" }] }));
  const removeContactRow = (idx: number) => setForm((f) => ({ ...f, contacts: f.contacts.filter((_, i) => i !== idx) }));

  const save = async () => {
    const contacts = form.contacts.filter((c) => c.label.trim() && c.whatsapp.trim());
    if (!form.name.trim() || !form.notes.trim() || contacts.length === 0) {
      setErr("Completa el nombre del proveedor, la descripción en Notas, y al menos un contacto de WhatsApp.");
      return;
    }
    setErr("");
    setBusy(true);
    const payload = {
      name: form.name.trim(),
      location: form.location.trim(),
      locationLat: form.locationLat,
      locationLng: form.locationLng,
      category: form.category.trim(),
      notes: form.notes.trim(),
      contacts,
    };
    const res = editingId
      ? await fetch(`/api/suppliers/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/suppliers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo guardar el proveedor.");
      return;
    }
    setFormOpen(false);
    setEditingId(null);
    router.refresh();
  };

  const remove = async (id: string) => {
    setBusy(true);
    await fetch(`/api/suppliers/${id}`, { method: "DELETE" });
    setBusy(false);
    setConfirmingDeleteId(null);
    router.refresh();
  };

  const review = async (id: string, action: "approve" | "reject") => {
    setBusy(true);
    await fetch(`/api/suppliers/${id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, rejectReason: action === "reject" ? rejectReason.trim() : undefined }),
    });
    setBusy(false);
    setRejectingId(null);
    setRejectReason("");
    router.refresh();
  };

  const pendingCount = pending.filter((p) => p.status === "PENDING").length;

  return (
    <div>
      {canReview && (
        <div className="flex gap-5.5 border-b border-rule mb-5.5">
          <button
            type="button"
            className={`pb-2.5 text-[13px] font-semibold border-b-2 cursor-pointer ${tab === "directorio" ? "text-ink border-teal" : "text-steel border-transparent hover:text-ink"}`}
            onClick={() => setTab("directorio")}
          >
            Directorio
          </button>
          <button
            type="button"
            className={`pb-2.5 text-[13px] font-semibold border-b-2 cursor-pointer ${tab === "pendientes" ? "text-ink border-teal" : "text-steel border-transparent hover:text-ink"}`}
            onClick={() => setTab("pendientes")}
          >
            Pendientes {pendingCount > 0 && <span className="ml-1 font-mono text-[10.5px] bg-red/15 text-red px-1.5 py-0.5 rounded-full">{pendingCount}</span>}
          </button>
        </div>
      )}

      {tab === "directorio" && (
        <div>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="text-[13px] text-steel">Directorio de proveedores y sus contactos de WhatsApp.</div>
            {canAdd && (
              <button
                type="button"
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60 shrink-0"
                onClick={startNew}
              >
                <Plus size={14} /> Nuevo proveedor
              </button>
            )}
          </div>

          {suppliers.length > 0 && (
            <div className="relative mb-4">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel" />
              <input
                className="w-full rounded border border-rule pl-8.5 pr-3 py-2 text-[13px]"
                placeholder="¿Qué necesitas? Ej. productos de cocina — ordena por probabilidad, no oculta a nadie"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}

          {formOpen && (
            <SupplierForm
              form={form}
              setForm={setForm}
              updateContact={updateContact}
              addContactRow={addContactRow}
              removeContactRow={removeContactRow}
              err={err}
              busy={busy}
              editing={!!editingId}
              onSave={save}
              onCancel={() => {
                setFormOpen(false);
                setEditingId(null);
              }}
            />
          )}

          {suppliers.length === 0 && !formOpen && (
            <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
              Aún no hay proveedores en el directorio.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {sortedSuppliers.map((s) => (
              <div key={s.id} className="bg-surface border border-rule rounded-md p-4">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className="font-semibold text-[14px]">{s.name}</span>
                  {isAdmin && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button type="button" className="text-steel hover:text-ink cursor-pointer" onClick={() => startEdit(s)}>
                        <Pencil size={13} />
                      </button>
                      {confirmingDeleteId === s.id ? (
                        <span className="flex items-center gap-1.5">
                          <button type="button" disabled={busy} className="text-red text-[11px] font-semibold cursor-pointer" onClick={() => remove(s.id)}>
                            Eliminar
                          </button>
                          <button type="button" className="text-steel text-[11px] cursor-pointer" onClick={() => setConfirmingDeleteId(null)}>
                            Cancelar
                          </button>
                        </span>
                      ) : (
                        <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => setConfirmingDeleteId(s.id)}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-steel mb-2">
                  {s.category && <span className="flex items-center gap-1"><Tag size={11} /> {s.category}</span>}
                  {s.location && <span className="flex items-center gap-1"><MapPin size={11} /> {s.location}</span>}
                  {s.locationLat !== null && s.locationLng !== null && (
                    <a
                      href={mapsLink(s.locationLat, s.locationLng)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-blue hover:underline"
                    >
                      <MapPin size={11} /> Ver ubicación
                    </a>
                  )}
                </div>
                {s.notes && <div className="text-[12.5px] text-ink/85 mb-2.5">{s.notes}</div>}
                <div className="flex flex-wrap gap-2">
                  {s.contacts.map((c, i) => (
                    <a
                      key={c.id ?? i}
                      href={waLink(c.whatsapp)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[12px] font-semibold border border-green bg-green/10 text-green rounded-full px-3 py-1.5 hover:bg-green/20"
                    >
                      <MessageCircle size={13} /> {c.label}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "pendientes" && canReview && (
        <div>
          {pending.length === 0 && (
            <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
              No hay propuestas pendientes ni rechazadas.
            </div>
          )}
          {pending.map((s) => (
            <div key={s.id} className="bg-surface border border-rule rounded-md p-4 mb-3">
              <div className="flex items-start justify-between gap-3 mb-1.5">
                <span className="font-semibold text-[14px]">{s.name}</span>
                <span
                  className="font-mono text-[10.5px] font-semibold px-2.5 py-1 rounded-full shrink-0"
                  style={
                    s.status === "PENDING"
                      ? { color: "#92A3C0", border: "1px solid #92A3C0", background: "#92A3C01a" }
                      : { color: "#C4453A", border: "1px solid #C4453A", background: "#C4453A1a" }
                  }
                >
                  {s.status === "PENDING" ? "Pendiente" : "Rechazado"}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-steel mb-2">
                {s.category && <span className="flex items-center gap-1"><Tag size={11} /> {s.category}</span>}
                {s.location && <span className="flex items-center gap-1"><MapPin size={11} /> {s.location}</span>}
                {s.locationLat !== null && s.locationLng !== null && (
                  <a
                    href={mapsLink(s.locationLat, s.locationLng)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-blue hover:underline"
                  >
                    <MapPin size={11} /> Ver ubicación
                  </a>
                )}
                <span>Propuesto por {s.createdByName ?? "—"}</span>
              </div>
              <div className="flex flex-wrap gap-2 mb-2.5">
                {s.contacts.map((c, i) => (
                  <span key={c.id ?? i} className="inline-flex items-center gap-1.5 text-[12px] bg-cloud border border-rule rounded-full px-2.5 py-1">
                    <MessageCircle size={12} /> {c.label}: {c.whatsapp}
                  </span>
                ))}
              </div>
              {s.status === "REJECTED" && s.rejectReason && (
                <div className="text-[12px] text-red mb-2">Motivo del rechazo: {s.rejectReason}</div>
              )}
              {s.status === "PENDING" && (
                <div>
                  {rejectingId === s.id ? (
                    <div className="mt-1">
                      <textarea
                        rows={2}
                        className="w-full rounded border border-rule px-2.5 py-2 text-[12.5px] mb-2"
                        placeholder="Motivo del rechazo (opcional)"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded border border-red bg-red px-3 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60"
                          onClick={() => review(s.id, "reject")}
                        >
                          Confirmar rechazo
                        </button>
                        <button type="button" className="text-steel text-[12px] cursor-pointer" onClick={() => setRejectingId(null)}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded border border-green bg-green px-3 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60"
                        onClick={() => review(s.id, "approve")}
                      >
                        <Check size={13} /> Aprobar
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer"
                        onClick={() => setRejectingId(s.id)}
                      >
                        <X size={13} /> Rechazar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SupplierForm({
  form,
  setForm,
  updateContact,
  addContactRow,
  removeContactRow,
  err,
  busy,
  editing,
  onSave,
  onCancel,
}: {
  form: typeof emptyForm;
  setForm: React.Dispatch<React.SetStateAction<typeof emptyForm>>;
  updateContact: (idx: number, field: "label" | "whatsapp", value: string) => void;
  addContactRow: () => void;
  removeContactRow: (idx: number) => void;
  err: string;
  busy: boolean;
  editing: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="bg-surface border border-rule rounded-md p-4.5 mb-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Proveedor</label>
          <input
            className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Nombre de la empresa"
          />
        </div>
        <div>
          <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Qué provee</label>
          <input
            className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            placeholder="Ej. mercadería por bulto, productos para el hogar, artículos de salud…"
          />
        </div>
      </div>

      <div className="mb-3">
        <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
          Ubicación (referencia corta)
        </label>
        <input
          className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
          value={form.location}
          onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
          placeholder="Ej. Guayaquil, cerca del Mall del Sol"
        />
      </div>

      <div className="mb-3">
        <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
          Marcar en el mapa (para llegar exacto)
        </label>
        <LocationPicker
          lat={form.locationLat}
          lng={form.locationLng}
          onChange={({ lat, lng }) => setForm((f) => ({ ...f, locationLat: lat, locationLng: lng }))}
        />
      </div>

      <div className="mb-3">
        <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
          Notas — descripción del catálogo (obligatorio)
        </label>
        <div className="text-[11px] text-steel mb-1.5">
          Pon la mayor cantidad de información posible sobre qué vende este proveedor — por ejemplo, copia y pega
          aquí la lista de productos desde tu chat de Telegram con ellos. El buscador usa este texto para
          encontrarlo cuando alguien busque un producto específico.
        </div>
        <textarea
          rows={5}
          className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          placeholder="Ej. Ropa y juguetes para niños, artículos escolares, bisutería, productos de limpieza para el hogar…"
        />
      </div>

      <label className="block mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Contactos de WhatsApp</label>
      {form.contacts.map((c, idx) => (
        <div key={idx} className="flex items-center gap-2 mb-2">
          <input
            className="flex-1 min-w-0 rounded border border-rule px-2.5 py-2 text-[13px]"
            placeholder="Ej. Asesor Juan"
            value={c.label}
            onChange={(e) => updateContact(idx, "label", e.target.value)}
          />
          <input
            className="flex-1 min-w-0 rounded border border-rule px-2.5 py-2 text-[13px]"
            placeholder="Ej. 593987654321"
            value={c.whatsapp}
            onChange={(e) => updateContact(idx, "whatsapp", e.target.value)}
          />
          {form.contacts.length > 1 && (
            <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => removeContactRow(idx)}>
              <X size={15} />
            </button>
          )}
        </div>
      ))}
      <button type="button" className="text-[12px] text-blue font-semibold cursor-pointer mb-3" onClick={addContactRow}>
        <Plus size={12} className="inline -mt-0.5" /> Agregar otro WhatsApp
      </button>

      {err && <div className="text-red text-[12.5px] mb-2.5">{err}</div>}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          disabled={busy}
          className="rounded border border-blue bg-blue px-4 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60"
          onClick={onSave}
        >
          {editing ? "Guardar cambios" : "Guardar"}
        </button>
        <button type="button" className="text-steel text-[13px] cursor-pointer" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
