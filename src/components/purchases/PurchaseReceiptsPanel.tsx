"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, Download, Upload, X, FileText, Check, Ban } from "lucide-react";

type ChangeRequestDTO = {
  action: "EDIT" | "DELETE";
  requestedByName: string | null;
  requestedAt: string;
  proposedProveedor: string | null;
  proposedMonto: number | null;
  proposedFechaPago: string | null;
  proposedFileUrl: string | null;
  proposedFileName: string | null;
};

type ReceiptDTO = {
  id: string;
  proveedor: string;
  monto: number;
  fechaPago: string;
  fileUrl: string;
  fileName: string;
  createdByName: string | null;
  createdAt: string;
  changeRequest: ChangeRequestDTO | null;
};

function fmtMoney(n: number) {
  return n.toLocaleString("es-EC", { style: "currency", currency: "USD" });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-EC", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
function toDateInputValue(iso: string) {
  return iso.slice(0, 10);
}

type Draft = { proveedor: string; monto: string; fechaPago: string; fileUrl: string; fileName: string };
const EMPTY_DRAFT: Draft = { proveedor: "", monto: "", fechaPago: "", fileUrl: "", fileName: "" };

// Comprobante de pago (Gestión de Compras) — confirmado 2026-07-23: solo el
// líder de Compras (y admin, o quien admin autorice puntualmente) ve esta
// sección. El líder crea directamente, pero editar/eliminar un comprobante ya
// creado requiere una solicitud que el admin debe aprobar — ver
// src/lib/guards.ts canManagePurchaseReceipts y las rutas .../request,
// .../approve, .../reject.
export function PurchaseReceiptsPanel({
  deptId,
  receipts,
  editable,
  isAdmin,
}: {
  deptId: string;
  receipts: ReceiptDTO[];
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

  function validate(d: Draft) {
    if (!d.proveedor.trim()) return "Ingresa el nombre del proveedor.";
    const monto = Number(d.monto);
    if (!monto || monto <= 0) return "Ingresa un monto válido.";
    if (!d.fechaPago) return "Ingresa la fecha de pago.";
    if (!d.fileUrl) return "Sube el comprobante.";
    return null;
  }

  async function createReceipt() {
    const v = validate(newDraft);
    if (v) return setErr(v);
    setErr("");
    setBusy(true);
    const res = await fetch("/api/purchase-receipts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deptId,
        proveedor: newDraft.proveedor.trim(),
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
      proveedor: r.proveedor,
      monto: String(r.monto),
      fechaPago: toDateInputValue(r.fechaPago),
      fileUrl: r.fileUrl,
      fileName: r.fileName,
    });
    setErr("");
  }

  async function saveEdit(id: string) {
    const v = validate(editDraft);
    if (v) return setErr(v);
    setErr("");
    setBusy(true);
    const body = {
      proveedor: editDraft.proveedor.trim(),
      monto: Number(editDraft.monto),
      fechaPago: editDraft.fechaPago,
      fileUrl: editDraft.fileUrl,
      fileName: editDraft.fileName,
    };
    const res = editIsRequest
      ? await fetch(`/api/purchase-receipts/${id}/request`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "EDIT", ...body }),
        })
      : await fetch(`/api/purchase-receipts/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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
        <input
          className="rounded border border-rule px-2.5 py-2 text-[13.5px] col-span-2"
          placeholder="Proveedor"
          value={draft.proveedor}
          onChange={(e) => setDraft({ ...draft, proveedor: e.target.value })}
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

      {receipts.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Aún no hay comprobantes de pago.
        </div>
      )}

      <div className="space-y-2.5">
        {receipts.map((r) => {
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
                      <div className="font-semibold text-[14.5px] mb-0.5">{r.proveedor}</div>
                      <div className="text-[12px] text-steel">
                        {fmtDate(r.fechaPago)} {r.createdByName && <>· subido por {r.createdByName}</>}
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
                          Cambiaría a: <b className="text-ink">{cr.proposedProveedor}</b>,{" "}
                          <b className="text-ink">{cr.proposedMonto != null ? fmtMoney(cr.proposedMonto) : ""}</b>,{" "}
                          {cr.proposedFechaPago && fmtDate(cr.proposedFechaPago)}
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
