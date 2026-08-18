"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, MessageCircle, MapPin, Tag, Check, X, Search, Globe, Lock, Eye, EyeOff } from "lucide-react";
import { LocationPicker } from "./LocationPicker";

export type SupplierContactDTO = { id?: string; label: string; whatsapp: string };
export type ChannelPlatform = "TELEGRAM" | "INSTAGRAM" | "FACEBOOK" | "OTHER";
export type SupplierChannelDTO = { id?: string; platform: ChannelPlatform; url: string };
export type SupplierType = "SUPPLIER" | "CARRIER";
export type SupplierBankAccountDTO = {
  id: string;
  bankName: string;
  bankAccountType: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  holderIdType: "RUC" | "CEDULA" | null;
  holderIdNumber: string | null;
  createdByName: string | null;
  createdAt: string;
};
export type SupplierDTO = {
  id: string;
  type: SupplierType;
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
  channels: SupplierChannelDTO[];
  // Presente solo cuando el que pide la página es admin — ver
  // canViewSupplierBankAccounts en guards.ts. Nadie más recibe este campo,
  // ni siquiera vacío, así que su sola presencia ya implica autorización.
  bankAccounts?: SupplierBankAccountDTO[];
  // Confirmado 2026-08-18: versión liviana para quien puede AGREGAR una
  // cuenta bancaria (ver canAddSupplierBankAccounts) pero no ver las ya
  // registradas — nunca expone banco/número/titular, solo si ya tiene una.
  hasBankAccount?: boolean;
};

function maskAccountNumber(number: string) {
  const last4 = number.slice(-4);
  return `•••• ${last4}`;
}

const CHANNEL_LABELS: Record<ChannelPlatform, string> = {
  TELEGRAM: "Telegram",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  OTHER: "Otro",
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
  channels: [] as SupplierChannelDTO[],
  // Confirmado 2026-08-18: pedido explícito del usuario — poder cargar la
  // cuenta bancaria del proveedor en el mismo formulario de creación, no
  // solo después desde la ficha. Opcional (un transportista puede no tenerla
  // todavía), pero si se llena algo, se exige completo — ver save().
  bankName: "",
  bankAccountType: "",
  bankAccountNumber: "",
  bankAccountHolder: "",
  holderIdType: "" as "" | "RUC" | "CEDULA",
  holderIdNumber: "",
};

const emptyAccountForm = {
  bankName: "", bankAccountType: "", bankAccountNumber: "", bankAccountHolder: "",
  holderIdType: "" as "" | "RUC" | "CEDULA", holderIdNumber: "",
};

export function SuppliersPanel({
  suppliers,
  pending,
  canAdd,
  canAddCarrier,
  canReview,
  isAdmin,
  canAddBankAccounts = false,
}: {
  suppliers: SupplierDTO[];
  pending: SupplierDTO[];
  canAdd: boolean;
  canAddCarrier: boolean;
  canReview: boolean;
  isAdmin: boolean;
  // Confirmado 2026-08-18: puede AGREGAR cuenta bancaria (delegado a
  // personas puntuales, hoy Jariel y Bryan) sin ser admin — separado de
  // `isAdmin`, que sigue siendo lo único que da acceso a VER las ya
  // registradas de otros proveedores. isAdmin ya implica esto (true).
  canAddBankAccounts?: boolean;
}) {
  const router = useRouter();
  // Confirmado 2026-08-14: pedido explícito del usuario — separar los
  // transportistas del directorio de proveedores normales, y poder
  // registrarlos ahí mismo sin pasar por Solicitar. Viven en la misma tabla
  // (type=CARRIER), solo se filtran/etiquetan distinto en esta pantalla.
  const [tab, setTab] = useState<"directorio" | "transportistas" | "pendientes">("directorio");
  const listType: SupplierType = tab === "transportistas" ? "CARRIER" : "SUPPLIER";
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formType, setFormType] = useState<SupplierType>("SUPPLIER");
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [query, setQuery] = useState("");
  const [addingContactId, setAddingContactId] = useState<string | null>(null);
  const [newContact, setNewContact] = useState({ label: "", whatsapp: "" });
  const [contactErr, setContactErr] = useState("");
  const [revealedAccountIds, setRevealedAccountIds] = useState<Set<string>>(new Set());
  const [addingAccountId, setAddingAccountId] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState(emptyAccountForm);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountErr, setAccountErr] = useState("");

  const toggleRevealAccount = (id: string) => {
    setRevealedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const listSuppliers = useMemo(() => suppliers.filter((s) => s.type === listType), [suppliers, listType]);
  const sortedSuppliers = useMemo(() => {
    if (!query.trim()) return listSuppliers;
    return [...listSuppliers].sort((a, b) => relevanceScore(b, query) - relevanceScore(a, query));
  }, [listSuppliers, query]);

  const startNew = () => {
    setEditingId(null);
    setFormType(listType);
    setForm(emptyForm);
    setFormOpen(true);
    setErr("");
  };

  const startEdit = (s: SupplierDTO) => {
    setEditingId(s.id);
    setFormType(s.type);
    setForm({
      name: s.name,
      location: s.location ?? "",
      locationLat: s.locationLat,
      locationLng: s.locationLng,
      category: s.category ?? "",
      notes: s.notes ?? "",
      contacts: s.contacts.length ? s.contacts.map((c) => ({ label: c.label, whatsapp: c.whatsapp })) : [{ label: "", whatsapp: "" }],
      channels: s.channels.map((c) => ({ platform: c.platform, url: c.url })),
      bankName: "",
      bankAccountType: "",
      bankAccountNumber: "",
      bankAccountHolder: "",
      holderIdType: "",
      holderIdNumber: "",
    });
    setFormOpen(true);
    setErr("");
  };

  const updateContact = (idx: number, field: "label" | "whatsapp", value: string) => {
    setForm((f) => ({ ...f, contacts: f.contacts.map((c, i) => (i === idx ? { ...c, [field]: value } : c)) }));
  };
  const addContactRow = () => setForm((f) => ({ ...f, contacts: [...f.contacts, { label: "", whatsapp: "" }] }));
  const removeContactRow = (idx: number) => setForm((f) => ({ ...f, contacts: f.contacts.filter((_, i) => i !== idx) }));

  const updateChannel = (idx: number, field: "platform" | "url", value: string) => {
    setForm((f) => ({ ...f, channels: f.channels.map((c, i) => (i === idx ? { ...c, [field]: value } : c)) }));
  };
  const addChannelRow = () => setForm((f) => ({ ...f, channels: [...f.channels, { platform: "TELEGRAM", url: "" }] }));
  const removeChannelRow = (idx: number) => setForm((f) => ({ ...f, channels: f.channels.filter((_, i) => i !== idx) }));

  const save = async () => {
    const contacts = form.contacts.filter((c) => c.label.trim() && c.whatsapp.trim());
    const channels = form.channels.filter((c) => c.url.trim()).map((c) => ({ platform: c.platform, url: c.url.trim() }));
    const noun = formType === "CARRIER" ? "transportista" : "proveedor";
    if (!form.name.trim() || !form.notes.trim() || contacts.length === 0) {
      setErr(`Completa el nombre del ${noun}, la descripción en Notas, y al menos un contacto de WhatsApp.`);
      return;
    }
    // Confirmado 2026-08-18: la cuenta bancaria es opcional al crear (un
    // transportista puede no tenerla todavía), pero si se llenó algo, se
    // exige completo — para no guardar una cuenta a medias.
    const bankFields = [form.bankName, form.bankAccountType, form.bankAccountNumber, form.bankAccountHolder, form.holderIdType, form.holderIdNumber];
    const bankStarted = bankFields.some((v) => v.trim());
    const bankComplete = bankFields.every((v) => v.trim());
    if (!editingId && bankStarted && !bankComplete) {
      setErr("Completa todos los datos de la cuenta bancaria, o déjalos todos vacíos si todavía no la tiene.");
      return;
    }
    setErr("");
    setBusy(true);
    const payload = {
      type: formType,
      name: form.name.trim(),
      location: form.location.trim(),
      locationLat: form.locationLat,
      locationLng: form.locationLng,
      category: form.category.trim(),
      notes: form.notes.trim(),
      contacts,
      channels,
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
    if (!res.ok) {
      setBusy(false);
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? `No se pudo guardar el ${noun}.`);
      return;
    }
    if (!editingId && bankComplete) {
      const created = await res.json().catch(() => null);
      if (created?.id) {
        const bankRes = await fetch(`/api/purchase-suppliers/${created.id}/bank-accounts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bankName: form.bankName.trim(),
            bankAccountType: form.bankAccountType.trim(),
            bankAccountNumber: form.bankAccountNumber.trim(),
            bankAccountHolder: form.bankAccountHolder.trim(),
            holderIdType: form.holderIdType,
            holderIdNumber: form.holderIdNumber.trim(),
          }),
        });
        if (!bankRes.ok) {
          setBusy(false);
          const data = await bankRes.json().catch(() => null);
          setErr(`El ${noun} se guardó, pero no se pudo agregar la cuenta bancaria: ${data?.error ?? "intenta agregarla después desde su ficha."}`);
          return;
        }
      }
    }
    setBusy(false);
    setFormOpen(false);
    setEditingId(null);
    router.refresh();
  };

  const remove = async (id: string, removeType: SupplierType) => {
    if (!confirm(`¿Eliminar este ${removeType === "CARRIER" ? "transportista" : "proveedor"} del directorio?`)) return;
    setBusy(true);
    await fetch(`/api/suppliers/${id}`, { method: "DELETE" });
    setBusy(false);
    setConfirmingDeleteId(null);
    router.refresh();
  };

  const addContact = async (supplierId: string) => {
    if (!newContact.label.trim() || !newContact.whatsapp.trim()) {
      setContactErr("Completa el nombre y el WhatsApp del asesor.");
      return;
    }
    setContactErr("");
    setBusy(true);
    const res = await fetch(`/api/suppliers/${supplierId}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newContact.label.trim(), whatsapp: newContact.whatsapp.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setContactErr(data?.error ?? "No se pudo agregar el asesor.");
      return;
    }
    setAddingContactId(null);
    setNewContact({ label: "", whatsapp: "" });
    router.refresh();
  };

  // Confirmado 2026-08-18: pedido explícito del usuario — desde el
  // directorio de Proveedores también se puede agregar una cuenta bancaria
  // nueva a un proveedor ya existente (mismo patrón que "Agregar asesor":
  // solo se suma, nunca se edita ni se elimina una ya registrada desde
  // aquí). Reusa el mismo endpoint que ya usa el picker de Control de
  // Compras, porque ambas pantallas leen/escriben la misma tabla de
  // proveedores y cuentas bancarias.
  const addBankAccount = async (supplierId: string) => {
    if (!accountForm.bankName.trim() || !accountForm.bankAccountType.trim() || !accountForm.bankAccountNumber.trim() || !accountForm.bankAccountHolder.trim() || !accountForm.holderIdType || !accountForm.holderIdNumber.trim()) {
      setAccountErr("Completa todos los campos.");
      return;
    }
    setAccountErr("");
    setAccountBusy(true);
    const res = await fetch(`/api/purchase-suppliers/${supplierId}/bank-accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(accountForm),
    });
    setAccountBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setAccountErr(data?.error ?? "No se pudo guardar la cuenta.");
      return;
    }
    setAddingAccountId(null);
    setAccountForm(emptyAccountForm);
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
          className={`pb-2.5 text-[13px] font-semibold border-b-2 cursor-pointer ${tab === "transportistas" ? "text-ink border-teal" : "text-steel border-transparent hover:text-ink"}`}
          onClick={() => setTab("transportistas")}
        >
          Transportistas
        </button>
        {canReview && (
          <button
            type="button"
            className={`pb-2.5 text-[13px] font-semibold border-b-2 cursor-pointer ${tab === "pendientes" ? "text-ink border-teal" : "text-steel border-transparent hover:text-ink"}`}
            onClick={() => setTab("pendientes")}
          >
            Pendientes {pendingCount > 0 && <span className="ml-1 font-mono text-[10.5px] bg-red/15 text-red px-1.5 py-0.5 rounded-full">{pendingCount}</span>}
          </button>
        )}
      </div>

      {(tab === "directorio" || tab === "transportistas") && (
        <div>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="text-[13px] text-steel">
              {listType === "CARRIER" ? "Transportistas y sus contactos de WhatsApp." : "Directorio de proveedores y sus contactos de WhatsApp."}
            </div>
            {(listType === "CARRIER" ? canAddCarrier : canAdd) && (
              <button
                type="button"
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60 shrink-0"
                onClick={startNew}
              >
                <Plus size={14} /> {listType === "CARRIER" ? "Nuevo transportista" : "Nuevo proveedor"}
              </button>
            )}
          </div>

          {listSuppliers.length > 0 && (
            <div className="relative mb-4">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel" />
              <input
                className="w-full rounded border border-rule pl-8.5 pr-3 py-2 text-[13px]"
                placeholder={listType === "CARRIER" ? "Buscar transportista…" : "¿Qué necesitas? Ej. productos de cocina — ordena por probabilidad, no oculta a nadie"}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}

          {formOpen && (
            <SupplierForm
              type={formType}
              canAddBankAccounts={isAdmin || canAddBankAccounts}
              form={form}
              setForm={setForm}
              updateContact={updateContact}
              addContactRow={addContactRow}
              removeContactRow={removeContactRow}
              updateChannel={updateChannel}
              addChannelRow={addChannelRow}
              removeChannelRow={removeChannelRow}
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

          {listSuppliers.length === 0 && !formOpen && (
            <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
              {listType === "CARRIER" ? "Aún no hay transportistas registrados." : "Aún no hay proveedores en el directorio."}
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
                          <button type="button" disabled={busy} className="text-red text-[11px] font-semibold cursor-pointer" onClick={() => remove(s.id, s.type)}>
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
                  {s.channels.map((c, i) => (
                    <a
                      key={c.id ?? i}
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[12px] font-semibold border border-blue bg-blue/10 text-blue rounded-full px-3 py-1.5 hover:bg-blue/20"
                    >
                      <Globe size={13} /> {CHANNEL_LABELS[c.platform]}
                    </a>
                  ))}
                  {canAdd && addingContactId !== s.id && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 text-[12px] font-semibold border border-dashed border-rule text-steel hover:text-ink hover:border-steel rounded-full px-3 py-1.5 cursor-pointer"
                      onClick={() => {
                        setAddingContactId(s.id);
                        setNewContact({ label: "", whatsapp: "" });
                        setContactErr("");
                      }}
                    >
                      <Plus size={13} /> Agregar asesor
                    </button>
                  )}
                </div>

                {canAdd && addingContactId === s.id && (
                  <div className="mt-2.5 pt-2.5 border-t border-rule">
                    <div className="text-[10.5px] text-steel mb-1.5">
                      Solo se agrega — no se puede editar ni quitar un asesor ya existente desde aquí.
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        className="flex-1 min-w-0 rounded border border-rule px-2.5 py-1.5 text-[12.5px]"
                        placeholder="Ej. Asesor Juan"
                        value={newContact.label}
                        onChange={(e) => setNewContact((c) => ({ ...c, label: e.target.value }))}
                      />
                      <input
                        className="flex-1 min-w-0 rounded border border-rule px-2.5 py-1.5 text-[12.5px]"
                        placeholder="Ej. 593987654321"
                        value={newContact.whatsapp}
                        onChange={(e) => setNewContact((c) => ({ ...c, whatsapp: e.target.value }))}
                      />
                    </div>
                    {contactErr && <div className="text-red text-[11.5px] mt-1.5">{contactErr}</div>}
                    <div className="flex items-center gap-2.5 mt-2">
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded border border-blue bg-blue px-3 py-1.5 text-[11.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
                        onClick={() => addContact(s.id)}
                      >
                        Guardar
                      </button>
                      <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => setAddingContactId(null)}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {(isAdmin ? !!s.bankAccounts : canAddBankAccounts) && (
                  <div className="mt-3 pt-3 border-t border-rule">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Lock size={12} className="text-steel" />
                      <span className="text-[11.5px] font-semibold text-ink">Datos bancarios</span>
                      <span className="text-[10px] font-semibold text-steel border border-rule rounded-full px-2 py-0.5">
                        {isAdmin ? "Exclusivo · admin" : "Solo agregar"}
                      </span>
                    </div>
                    {!isAdmin && (
                      <div className="text-[11.5px] text-steel mb-2">
                        {s.hasBankAccount ? "Ya tiene cuenta bancaria registrada." : "Sin cuenta bancaria registrada."} No puedes ver los datos de las ya existentes — solo agregar una nueva.
                      </div>
                    )}
                    {isAdmin && s.bankAccounts && s.bankAccounts.length === 0 && addingAccountId !== s.id && (
                      <div className="text-[11.5px] text-steel mb-2">Sin cuentas bancarias registradas.</div>
                    )}
                    {isAdmin && s.bankAccounts && s.bankAccounts.length > 0 && (
                      <div className="flex flex-col gap-2 mb-2">
                        {s.bankAccounts.map((b) => {
                          const revealed = revealedAccountIds.has(b.id);
                          return (
                            <div key={b.id} className="bg-cloud border border-rule rounded px-3 py-2.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[12.5px] font-semibold text-ink">
                                  {b.bankName} · {b.bankAccountType}
                                </span>
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-steel hover:text-ink cursor-pointer shrink-0"
                                  onClick={() => toggleRevealAccount(b.id)}
                                >
                                  {revealed ? <EyeOff size={12} /> : <Eye size={12} />} {revealed ? "Ocultar" : "Revelar"}
                                </button>
                              </div>
                              <div className="text-[13px] font-mono text-ink mt-1.5">
                                {revealed ? b.bankAccountNumber : maskAccountNumber(b.bankAccountNumber)}
                              </div>
                              <div className="text-[11px] text-steel mt-1.5">
                                Titular: {b.bankAccountHolder}
                                {b.holderIdType && b.holderIdNumber ? ` · ${b.holderIdType === "RUC" ? "RUC" : "Cédula"} ${b.holderIdNumber}` : ""}
                              </div>
                              <div className="text-[10.5px] text-steel-dim mt-1">
                                Agregada por {b.createdByName ?? "—"} · {new Date(b.createdAt).toLocaleDateString("es-EC", { day: "numeric", month: "short", year: "numeric" })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {addingAccountId === s.id ? (
                      <div className="bg-cloud border border-rule rounded-md p-2.5">
                        <div className="text-[10.5px] text-steel mb-1.5">
                          Solo se agrega — no se puede editar ni eliminar una cuenta ya existente desde aquí.
                        </div>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <input className="rounded border border-rule px-2 py-1.5 text-[12px]" placeholder="Banco" value={accountForm.bankName} onChange={(e) => setAccountForm((f) => ({ ...f, bankName: e.target.value }))} />
                          <input className="rounded border border-rule px-2 py-1.5 text-[12px]" placeholder="N° de cuenta" value={accountForm.bankAccountNumber} onChange={(e) => setAccountForm((f) => ({ ...f, bankAccountNumber: e.target.value }))} />
                        </div>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <select className="rounded border border-rule bg-surface px-2 py-1.5 text-[12px]" value={accountForm.bankAccountType} onChange={(e) => setAccountForm((f) => ({ ...f, bankAccountType: e.target.value }))}>
                            <option value="">Tipo de cuenta…</option>
                            <option value="Ahorro">Ahorro</option>
                            <option value="Corriente">Corriente</option>
                          </select>
                          <select className="rounded border border-rule bg-surface px-2 py-1.5 text-[12px]" value={accountForm.holderIdType} onChange={(e) => setAccountForm((f) => ({ ...f, holderIdType: e.target.value as "" | "RUC" | "CEDULA" }))}>
                            <option value="">RUC o cédula…</option>
                            <option value="RUC">RUC</option>
                            <option value="CEDULA">Cédula</option>
                          </select>
                        </div>
                        <input className="w-full rounded border border-rule px-2 py-1.5 text-[12px] mb-2" placeholder="Titular de la cuenta" value={accountForm.bankAccountHolder} onChange={(e) => setAccountForm((f) => ({ ...f, bankAccountHolder: e.target.value }))} />
                        <input className="w-full rounded border border-rule px-2 py-1.5 text-[12px] mb-2" placeholder={accountForm.holderIdType === "CEDULA" ? "N° de cédula" : "N° de RUC"} value={accountForm.holderIdNumber} onChange={(e) => setAccountForm((f) => ({ ...f, holderIdNumber: e.target.value }))} />
                        {accountErr && <div className="text-red text-[11.5px] mb-2">{accountErr}</div>}
                        <div className="flex items-center gap-2">
                          <button type="button" disabled={accountBusy} className="rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={() => addBankAccount(s.id)}>
                            Guardar cuenta
                          </button>
                          <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => { setAddingAccountId(null); setAccountErr(""); }}>
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-[11.5px] text-blue font-semibold cursor-pointer"
                        onClick={() => { setAddingAccountId(s.id); setAccountForm(emptyAccountForm); setAccountErr(""); }}
                      >
                        <Plus size={12} /> Agregar cuenta bancaria nueva
                      </button>
                    )}
                  </div>
                )}
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
                {s.channels.map((c, i) => (
                  <span key={c.id ?? i} className="inline-flex items-center gap-1.5 text-[12px] bg-cloud border border-rule rounded-full px-2.5 py-1">
                    <Globe size={12} /> {CHANNEL_LABELS[c.platform]}
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
  type,
  canAddBankAccounts,
  form,
  setForm,
  updateContact,
  addContactRow,
  removeContactRow,
  updateChannel,
  addChannelRow,
  removeChannelRow,
  err,
  busy,
  editing,
  onSave,
  onCancel,
}: {
  type: SupplierType;
  canAddBankAccounts: boolean;
  form: typeof emptyForm;
  setForm: React.Dispatch<React.SetStateAction<typeof emptyForm>>;
  updateContact: (idx: number, field: "label" | "whatsapp", value: string) => void;
  addContactRow: () => void;
  removeContactRow: (idx: number) => void;
  updateChannel: (idx: number, field: "platform" | "url", value: string) => void;
  addChannelRow: () => void;
  removeChannelRow: (idx: number) => void;
  err: string;
  busy: boolean;
  editing: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const isCarrier = type === "CARRIER";
  return (
    <div className="bg-surface border border-rule rounded-md p-4.5 mb-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">{isCarrier ? "Transportista" : "Proveedor"}</label>
          <input
            className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Nombre de la empresa"
          />
        </div>
        <div>
          <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">{isCarrier ? "Qué transporta" : "Qué provee"} <span className="text-steel-dim">(opcional)</span></label>
          <input
            className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            placeholder={isCarrier ? "Ej. Entregas dentro de Guayaquil, moto propia…" : "Ej. mercadería por bulto, productos para el hogar, artículos de salud…"}
          />
        </div>
      </div>

      {!isCarrier && (
        <>
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
        </>
      )}

      <div className="mb-3">
        <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
          Notas — {isCarrier ? "descripción del servicio" : "descripción del catálogo"} (obligatorio)
        </label>
        <div className="text-[11px] text-steel mb-1.5">
          {isCarrier
            ? "Describe la cobertura y condiciones del servicio — zonas, tipo de vehículo, disponibilidad."
            : "Pon la mayor cantidad de información posible sobre qué vende este proveedor — por ejemplo, copia y pega aquí la lista de productos desde tu chat de Telegram con ellos. El buscador usa este texto para encontrarlo cuando alguien busque un producto específico."}
        </div>
        <textarea
          rows={5}
          className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          placeholder={isCarrier ? "Ej. Entregas dentro de Guayaquil, moto propia, disponible de lunes a sábado…" : "Ej. Ropa y juguetes para niños, artículos escolares, bisutería, productos de limpieza para el hogar…"}
        />
      </div>

      {canAddBankAccounts && !editing && (
        <div className="mb-3.5 bg-cloud border border-rule rounded-md p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Lock size={12} className="text-steel" />
            <span className="text-[11.5px] font-semibold text-ink">Datos bancarios</span>
            <span className="text-[10px] font-semibold text-steel border border-rule rounded-full px-2 py-0.5">Opcional</span>
          </div>
          <div className="text-[10.5px] text-steel mb-2">
            Si {isCarrier ? "el transportista" : "el proveedor"} ya tiene cuenta, complétala aquí de una vez — si no, se puede agregar después desde su ficha en el directorio. Una vez guardada no se puede editar ni eliminar desde aquí, solo agregar cuentas nuevas.
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input className="rounded border border-rule px-2.5 py-1.5 text-[12.5px]" placeholder="Banco" value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} />
            <input className="rounded border border-rule px-2.5 py-1.5 text-[12.5px]" placeholder="N° de cuenta" value={form.bankAccountNumber} onChange={(e) => setForm((f) => ({ ...f, bankAccountNumber: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <select className="rounded border border-rule bg-surface px-2.5 py-1.5 text-[12.5px]" value={form.bankAccountType} onChange={(e) => setForm((f) => ({ ...f, bankAccountType: e.target.value }))}>
              <option value="">Tipo de cuenta…</option>
              <option value="Ahorro">Ahorro</option>
              <option value="Corriente">Corriente</option>
            </select>
            <select className="rounded border border-rule bg-surface px-2.5 py-1.5 text-[12.5px]" value={form.holderIdType} onChange={(e) => setForm((f) => ({ ...f, holderIdType: e.target.value as "" | "RUC" | "CEDULA" }))}>
              <option value="">RUC o cédula…</option>
              <option value="RUC">RUC</option>
              <option value="CEDULA">Cédula</option>
            </select>
          </div>
          <input className="w-full rounded border border-rule px-2.5 py-1.5 text-[12.5px] mb-2" placeholder="Titular de la cuenta" value={form.bankAccountHolder} onChange={(e) => setForm((f) => ({ ...f, bankAccountHolder: e.target.value }))} />
          <input className="w-full rounded border border-rule px-2.5 py-1.5 text-[12.5px]" placeholder={form.holderIdType === "CEDULA" ? "N° de cédula" : "N° de RUC"} value={form.holderIdNumber} onChange={(e) => setForm((f) => ({ ...f, holderIdNumber: e.target.value }))} />
        </div>
      )}

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

      <label className="block mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
        Canales (opcional) — Telegram, Instagram, Facebook u otro
      </label>
      {form.channels.map((c, idx) => (
        <div key={idx} className="flex items-center gap-2 mb-2">
          <select
            className="rounded border border-rule px-2.5 py-2 text-[13px] bg-surface shrink-0"
            value={c.platform}
            onChange={(e) => updateChannel(idx, "platform", e.target.value)}
          >
            {(Object.keys(CHANNEL_LABELS) as ChannelPlatform[]).map((p) => (
              <option key={p} value={p}>{CHANNEL_LABELS[p]}</option>
            ))}
          </select>
          <input
            className="flex-1 min-w-0 rounded border border-rule px-2.5 py-2 text-[13px]"
            placeholder="https://t.me/tu-canal"
            value={c.url}
            onChange={(e) => updateChannel(idx, "url", e.target.value)}
          />
          <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => removeChannelRow(idx)}>
            <X size={15} />
          </button>
        </div>
      ))}
      <button type="button" className="text-[12px] text-blue font-semibold cursor-pointer mb-3" onClick={addChannelRow}>
        <Plus size={12} className="inline -mt-0.5" /> Agregar canal
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
