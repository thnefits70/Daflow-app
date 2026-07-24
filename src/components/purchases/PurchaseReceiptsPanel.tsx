"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, Download, Upload, X, FileText, Check, Ban, Search } from "lucide-react";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";

type ChangeRequestDTO = {
  action: "EDIT" | "DELETE";
  requestedByName: string | null;
  requestedAt: string;
  proposedSupplierName: string | null;
  proposedNumeroComprobante: string | null;
  proposedBankName: string | null;
  proposedMonto: number | null;
  proposedFechaPago: string | null;
  proposedFileUrl: string | null;
  proposedFileName: string | null;
};

type ReceiptDTO = {
  id: string;
  supplierName: string;
  numeroComprobante: string | null;
  bankName: string | null;
  monto: number;
  fechaPago: string;
  fileUrl: string;
  fileName: string;
  createdByName: string | null;
  createdAt: string;
  changeRequest: ChangeRequestDTO | null;
};

type CatalogDTO = { id: string; name: string };

function fmtMoney(n: number) {
  return n.toLocaleString("es-EC", { style: "currency", currency: "USD" });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-EC", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
function toDateInputValue(iso: string) {
  return iso.slice(0, 10);
}

type Draft = { supplierName: string; numeroComprobante: string; bankName: string; monto: string; fechaPago: string; fileUrl: string; fileName: string };
const EMPTY_DRAFT: Draft = { supplierName: "", numeroComprobante: "", bankName: "", monto: "", fechaPago: "", fileUrl: "", fileName: "" };

const COMBO_INPUT_CLASS = "w-full rounded border border-rule px-2.5 py-2 text-[13.5px]";

// Comprobante de pago (Gestión de Compras) — confirmado 2026-07-23/24: solo
// el líder de Compras (y admin, o quien admin autorice puntualmente) ve esta
// sección. El líder crea directamente, pero editar/eliminar un comprobante ya
// creado requiere una solicitud que el admin debe aprobar — ver
// src/lib/guards.ts canManagePurchaseReceipts y las rutas .../request,
// .../approve, .../reject. Proveedor y banco son catálogos "escribe o elige"
// (mismo patrón que Ruptura de Stock) — se crean sobre la marcha si no
// existen todavía.
export function PurchaseReceiptsPanel({
  deptId,
  receipts,
  suppliers,
  banks,
  editable,
  isAdmin,
}: {
  deptId: string;
  receipts: ReceiptDTO[];
  suppliers: CatalogDTO[];
  banks: CatalogDTO[];
  editable: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editIsRequest, setEditIsRequest] = useState(false);

  const [search, setSearch] = useState("");
  const [monthFrom, setMonthFrom] = useState("");
  const [monthTo, setMonthTo] = useState("");

  const supplierOptions: ComboboxOption[] = suppliers.map((s) => ({ id: s.id, name: s.name }));
  const bankOptions: ComboboxOption[] = banks.map((b) => ({ id: b.id, name: b.name }));

  const searchQuery = search.trim().toLowerCase();
  const shown = receipts.filter((r) => {
    if (searchQuery) {
      const haystack = `${r.supplierName} ${r.bankName ?? ""} ${r.numeroComprobante ?? ""}`.toLowerCase();
      if (!haystack.includes(searchQuery)) return false;
    }
    const period = r.fechaPago.slice(0, 7); // "YYYY-MM"
    if (monthFrom && period < monthFrom) return false;
    if (monthTo && period > monthTo) return false;
    return true;
  });

  async function uploadFile(file: File, onDone: (url: string, name: string) => void) {
    setErr("");
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", "purchase-receipts");
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo subir el archivo.");
      return;
    }
    const data = await res.json();
    onDone(data.url, data.name);
  }

  // Resolves a typed catalog name to an id — reuses an existing entry
  // (case-insensitive) or creates one on the fly, same pattern as
  // StockoutPanel's addToWeek. Returns null (and sets `err`) on failure.
  async function resolveCatalogId(
    kind: "supplier" | "bank",
    name: string,
    options: CatalogDTO[]
  ): Promise<string | null> {
    const trimmed = name.trim();
    const existing = options.find((o) => o.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;

    const endpoint = kind === "supplier" ? "/api/purchase-receipt-suppliers" : "/api/purchase-receipt-banks";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deptId, name: trimmed }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? `No se pudo crear el ${kind === "supplier" ? "proveedor" : "banco"}.`);
      return null;
    }
    return (await res.json()).id;
  }

  function validateBase(d: Draft) {
    if (!d.supplierName.trim()) return "Elige o escribe un proveedor.";
    const monto = Number(d.monto);
    if (!monto || monto <= 0) return "Ingresa un monto válido.";
    if (!d.fechaPago) return "Ingresa la fecha de pago.";
    if (!d.fileUrl) return "Sube el comprobante.";
    return null;
  }

  async function createReceipt() {
    const v = validateBase(newDraft);
    if (v) return setErr(v);
    setErr("");
    setBusy(true);

    const supplierId = await resolveCatalogId("supplier", newDraft.supplierName, suppliers);
    if (!supplierId) return setBusy(false);
    let bankId: string | null = null;
    if (newDraft.bankName.trim()) {
      bankId = await resolveCatalogId("bank", newDraft.bankName, banks);
      if (!bankId) return setBusy(false);
    }

    const res = await fetch("/api/purchase-receipts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deptId,
        supplierId,
        bankId: bankId ?? undefined,
        numeroComprobante: newDraft.numeroComprobante.trim() || undefined,
        monto: Number(newDraft.monto),
        fechaPago: newDraft.fechaPago,
        fileUrl: newDraft.fileUrl,
        fileName: newDraft.fileName,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo crear el comprobante.");
      return;
    }
    setNewDraft(EMPTY_DRAFT);
    setShowForm(false);
    router.refresh();
  }

  function openEdit(r: ReceiptDTO, asRequest: boolean) {
    setEditingId(r.id);
    setEditIsRequest(asRequest);
    setEditDraft({
      supplierName: r.supplierName,
      numeroComprobante: r.numeroComprobante ?? "",
      bankName: r.bankName ?? "",
      monto: String(r.monto),
      fechaPago: toDateInputValue(r.fechaPago),
      fileUrl: r.fileUrl,
      fileName: r.fileName,
    });
    setErr("");
  }

  async function saveEdit(id: string) {
    const v = validateBase(editDraft);
    if (v) return setErr(v);
    setErr("");
    setBusy(true);

    const supplierId = await resolveCatalogId("supplier", editDraft.supplierName, suppliers);
    if (!supplierId) return setBusy(false);
    let bankId: string | null = null;
    if (editDraft.bankName.trim()) {
      bankId = await resolveCatalogId("bank", editDraft.bankName, banks);
      if (!bankId) return setBusy(false);
    }

    const numeroComprobante = editDraft.numeroComprobante.trim() || null;
    const common = {
      supplierId,
      monto: Number(editDraft.monto),
      fechaPago: editDraft.fechaPago,
      fileUrl: editDraft.fileUrl,
      fileName: editDraft.fileName,
    };
    // The direct-PATCH schema is nullable (explicit null clears the field);
    // the request-creation schema is only optional (it normalizes a missing
    // field to null itself) — so the two payloads differ only in whether an
    // empty bank/número is sent as `null` or simply omitted.
    const res = editIsRequest
      ? await fetch(`/api/purchase-receipts/${id}/request`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "EDIT",
            ...common,
            bankId: bankId ?? undefined,
            numeroComprobante: numeroComprobante ?? undefined,
          }),
        })
      : await fetch(`/api/purchase-receipts/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...common, bankId, numeroComprobante }),
        });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo guardar.");
      return;
    }
    setEditingId(null);
    router.refresh();
  }

  async function requestDelete(id: string) {
    if (!confirm("¿Solicitar la eliminación de este comprobante? El administrador debe aprobarlo antes de que se elimine.")) return;
    setBusy(true);
    const res = await fetch(`/api/purchase-receipts/${id}/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "DELETE" }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo enviar la solicitud.");
      return;
    }
    router.refresh();
  }

  async function directDelete(id: string) {
    if (!confirm("¿Eliminar este comprobante de pago? Esta acción no se puede deshacer.")) return;
    setBusy(true);
    await fetch(`/api/purchase-receipts/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  async function cancelRequest(id: string) {
    setBusy(true);
    await fetch(`/api/purchase-receipts/${id}/request`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  async function approve(id: string) {
    setBusy(true);
    const res = await fetch(`/api/purchase-receipts/${id}/approve`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo aprobar la solicitud.");
      return;
    }
    router.refresh();
  }

  async function reject(id: string) {
    setBusy(true);
    await fetch(`/api/purchase-receipts/${id}/reject`, { method: "POST" });
    setBusy(false);
    router.refresh();
  }

  function draftForm(draft: Draft, setDraft: (d: Draft) => void) {
    return (
      <div className="grid grid-cols-2 gap-2.5 mb-3">
        <div className="col-span-2">
          <Combobox
            value={draft.supplierName}
            onChange={(v) => setDraft({ ...draft, supplierName: v })}
            options={supplierOptions}
            placeholder="Proveedor — escribe o elige uno existente"
            className={COMBO_INPUT_CLASS}
          />
        </div>
        <input
          className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
          placeholder="Número de comprobante (opcional)"
          value={draft.numeroComprobante}
          onChange={(e) => setDraft({ ...draft, numeroComprobante: e.target.value })}
        />
        <Combobox
          value={draft.bankName}
          onChange={(v) => setDraft({ ...draft, bankName: v })}
          options={bankOptions}
          placeholder="Banco (opcional)"
          className={COMBO_INPUT_CLASS}
        />
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-green font-semibold text-[13.5px]">$</span>
          <input
            type="number"
            step="0.01"
            min={0}
            className="w-full rounded border border-rule pl-6 pr-2.5 py-2 text-[13.5px]"
            placeholder="Monto pagado"
            value={draft.monto}
            onChange={(e) => setDraft({ ...draft, monto: e.target.value })}
          />
        </div>
        <input
          type="date"
          className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
          value={draft.fechaPago}
          onChange={(e) => setDraft({ ...draft, fechaPago: e.target.value })}
        />
        <div className="col-span-2">
          {draft.fileUrl ? (
            <div className="flex items-center justify-between gap-2 border border-rule rounded px-2.5 py-2">
              <span className="text-[13px] flex items-center gap-1.5"><FileText size={13} /> {draft.fileName}</span>
              <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => setDraft({ ...draft, fileUrl: "", fileName: "" })}>
                <X size={14} />
              </button>
            </div>
          ) : (
            <label className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold border border-rule rounded px-3 py-2 cursor-pointer">
              <Upload size={13} /> {busy ? "Subiendo…" : "Subir comprobante"}
              <input
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                disabled={busy}
                onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0], (url, name) => setDraft({ ...draft, fileUrl: url, fileName: name }))}
              />
            </label>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-[13px] text-steel mb-4 max-w-2xl">
        Comprobantes de pago a proveedores — visible solo para ti y el administrador. Tú puedes subir comprobantes
        directamente; editar o eliminar uno ya creado necesita la aprobación del administrador.
      </div>

      {editable && (
        <div className="mb-4">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer"
            onClick={() => setShowForm((s) => !s)}
          >
            <Plus size={14} /> Nuevo comprobante
          </button>
        </div>
      )}

      {editable && showForm && (
        <div className="bg-surface border border-rule rounded p-4 mb-4">
          {draftForm(newDraft, setNewDraft)}
          <button
            type="button"
            disabled={busy}
            className="rounded border border-blue bg-blue px-4 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60"
            onClick={createReceipt}
          >
            Guardar comprobante
          </button>
          {err && <div className="text-red text-[12.5px] mt-2">{err}</div>}
        </div>
      )}

      {receipts.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-steel" />
            <input
              className="w-full rounded border border-rule pl-8 pr-2.5 py-2 text-[13px]"
              placeholder="Buscar por proveedor, banco o número..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-steel font-bold mb-1">Desde</div>
            <input type="month" className="rounded border border-rule px-2.5 py-1.5 text-[12.5px]" value={monthFrom} onChange={(e) => setMonthFrom(e.target.value)} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-steel font-bold mb-1">Hasta</div>
            <input type="month" className="rounded border border-rule px-2.5 py-1.5 text-[12.5px]" value={monthTo} onChange={(e) => setMonthTo(e.target.value)} />
          </div>
          {(search || monthFrom || monthTo) && (
            <button
              type="button"
              className="text-[12px] text-steel border border-rule rounded px-2.5 py-1.5 cursor-pointer"
              onClick={() => {
                setSearch("");
                setMonthFrom("");
                setMonthTo("");
              }}
            >
              Limpiar filtros
            </button>
          )}
        </div>
      )}

      {receipts.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Aún no hay comprobantes de pago.
        </div>
      )}
      {receipts.length > 0 && shown.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Ningún comprobante coincide con tu búsqueda o filtro.
        </div>
      )}

      <div className="space-y-2.5">
        {shown.map((r) => {
          const cr = r.changeRequest;
          const isEditingThis = editingId === r.id;
          return (
            <div key={r.id} className="bg-surface border border-rule rounded p-4">
              {isEditingThis ? (
                <div>
                  {draftForm(editDraft, setEditDraft)}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      className="text-[12px] font-semibold text-white bg-blue border border-blue rounded px-3 py-1.5 cursor-pointer disabled:opacity-60"
                      onClick={() => saveEdit(r.id)}
                    >
                      {editIsRequest ? "Enviar solicitud" : "Guardar"}
                    </button>
                    <button type="button" className="text-[12px] text-steel cursor-pointer" onClick={() => { setEditingId(null); setErr(""); }}>
                      Cancelar
                    </button>
                  </div>
                  {err && <div className="text-red text-[12px] mt-2">{err}</div>}
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-semibold text-[14.5px] mb-0.5">{r.supplierName}</div>
                      <div className="text-[12px] text-steel">
                        {fmtDate(r.fechaPago)}
                        {r.bankName && <> · {r.bankName}</>}
                        {r.numeroComprobante && <> · N° {r.numeroComprobante}</>}
                        {r.createdByName && <> · subido por {r.createdByName}</>}
                      </div>
                    </div>
                    <span className="text-green text-[17px] font-extrabold whitespace-nowrap">{fmtMoney(r.monto)}</span>
                  </div>

                  <div className="flex items-center gap-2.5 mt-2.5">
                    <a
                      href={r.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[12px] font-semibold border border-rule rounded px-2.5 py-1.5 text-steel hover:text-ink"
                    >
                      <FileText size={13} /> {r.fileName}
                    </a>
                    <a href={r.fileUrl} download={r.fileName} className="text-steel hover:text-ink">
                      <Download size={15} />
                    </a>
                  </div>

                  {cr ? (
                    <div className="mt-3 border border-dashed border-rule rounded p-3 bg-cloud/40">
                      <div className="text-[12px] font-semibold text-steel mb-1.5">
                        ⏳ Solicitud pendiente: {cr.action === "EDIT" ? "editar" : "eliminar"}
                        {cr.requestedByName && <> · pedida por {cr.requestedByName}</>}
                      </div>
                      {cr.action === "EDIT" && (
                        <div className="text-[12px] text-steel mb-2">
                          Cambiaría a: <b className="text-ink">{cr.proposedSupplierName}</b>,{" "}
                          <b className="text-ink">{cr.proposedMonto != null ? fmtMoney(cr.proposedMonto) : ""}</b>,{" "}
                          {cr.proposedFechaPago && fmtDate(cr.proposedFechaPago)}
                          {cr.proposedBankName && <> · banco: {cr.proposedBankName}</>}
                          {cr.proposedNumeroComprobante && <> · N° {cr.proposedNumeroComprobante}</>}
                          {cr.proposedFileName && cr.proposedFileName !== r.fileName && <> · nuevo archivo: {cr.proposedFileName}</>}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        {isAdmin ? (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              className="inline-flex items-center gap-1 text-[12px] font-semibold text-white bg-teal border border-teal rounded px-2.5 py-1.5 cursor-pointer disabled:opacity-60"
                              onClick={() => approve(r.id)}
                            >
                              <Check size={12} /> Aprobar
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              className="inline-flex items-center gap-1 text-[12px] text-steel border border-rule rounded px-2.5 py-1.5 cursor-pointer disabled:opacity-60"
                              onClick={() => reject(r.id)}
                            >
                              <Ban size={12} /> Rechazar
                            </button>
                          </>
                        ) : editable ? (
                          <button
                            type="button"
                            disabled={busy}
                            className="text-[12px] text-steel border border-rule rounded px-2.5 py-1.5 cursor-pointer disabled:opacity-60"
                            onClick={() => cancelRequest(r.id)}
                          >
                            Cancelar solicitud
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end gap-2 mt-3">
                      {isAdmin ? (
                        <>
                          <button type="button" className="text-steel hover:text-ink cursor-pointer" title="Editar" onClick={() => openEdit(r, false)}>
                            <Pencil size={15} />
                          </button>
                          <button type="button" className="text-steel hover:text-red cursor-pointer" title="Eliminar" onClick={() => directDelete(r.id)}>
                            <Trash2 size={15} />
                          </button>
                        </>
                      ) : editable ? (
                        <>
                          <button
                            type="button"
                            className="text-[12px] text-steel border border-rule rounded px-2.5 py-1.5 cursor-pointer"
                            onClick={() => openEdit(r, true)}
                          >
                            Solicitar edición
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="text-[12px] text-steel border border-rule rounded px-2.5 py-1.5 cursor-pointer disabled:opacity-60"
                            onClick={() => requestDelete(r.id)}
                          >
                            Solicitar eliminación
                          </button>
                        </>
                      ) : null}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
