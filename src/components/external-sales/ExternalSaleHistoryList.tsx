"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Printer, Trash2 } from "lucide-react";
import { formatDateTime } from "@/lib/formatDateTime";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { saleSteps, saleColumn, FLOW_COLUMNS, TimelineSteps } from "@/components/external-sales/SaleTimeline";

type SaleItemDTO = {
  id: string;
  declaredProductName: string;
  catalogItem: { name: string; justCode: string | null } | null;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  rejectedAt: string | null;
  rejectionReason: string | null;
};
type SaleDTO = {
  id: string;
  code: string;
  items: SaleItemDTO[];
  totalAmount: number;
  pickupPersonName: string;
  courierNote: string | null;
  freightCost: number | null;
  client: { name: string; idType: "RUC" | "CEDULA" | null; idNumber: string | null; phone: string; email: string | null; city: string | null; country: string | null } | null;
  isContraEntrega: boolean;
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  paymentProofUrl: string | null;
  paymentProofName: string | null;
  paymentConfirmedAt: string | null;
  paymentConfirmedBy: { name: string } | null;
  invoiceUrl: string | null;
  invoiceUploadedAt: string | null;
  invoiceUploadedBy: { name: string } | null;
  nairobyClosedAt: string | null;
  closeReceivedAmount: number | null;
  closeDifferenceReason: "FLETE_MOTORIZADO" | "OTRO" | null;
  closeDifferenceNote: string | null;
  createdAt: string;
  advisor: { name: string } | null;
  reviewedAt: string | null;
  reviewedBy: { name: string } | null;
  dispatchAssignedTo: { name: string } | null;
  dispatchAssignedAt: string | null;
  prepReadyAt: string | null;
  prepReadyBy: { name: string } | null;
  packAssignedAt: string | null;
  packAssignedTo: { name: string } | null;
  deliveredAt: string | null;
  deliveredBy: { name: string } | null;
  returnedAt: string | null;
  returnReason: string | null;
  returnReceivedAt: string | null;
  returnConfirmedAt: string | null;
  deletedAt: string | null;
};

// Pedido explícito de Yair (2026-09-19, por audio): desde el tablero de
// Historial una venta "pegada" en Aprobada/Pago confirmado/Facturada/
// Agrupada parece rota, pero casi siempre solo está esperando a otra
// persona (Nairoby con la factura, Daniel con la agrupación, el propio
// Yair con el embalaje). Esto hace explícito a quién le toca el siguiente
// paso, para no confundir "está esperando a alguien" con "el sistema no
// avanza". No usa saleColumn() porque pago/facturación/cierre son
// independientes del tramo de despacho — este hint sigue ESE tramo
// puntual (agrupar → embalar → entregar → cerrar) sin importar en qué
// columna cae la venta.
function nextActionHint(s: SaleDTO): string | null {
  if (s.deletedAt || s.reviewStatus === "REJECTED") return null;
  if (!s.reviewedAt) return "Esperando que Bryan la apruebe";
  if (s.deliveredAt) return s.nairobyClosedAt ? null : "Esperando que Nairoby cierre la venta";
  if (s.packAssignedTo) return `Esperando que ${s.packAssignedTo.name} confirme la entrega`;
  if (s.prepReadyAt) return "Esperando que Yair asigne quién embala";
  if (s.dispatchAssignedTo) return `Esperando que ${s.dispatchAssignedTo.name} agrupe y marque listo`;
  return "Esperando que Daniel asigne quién agrupa";
}

function itemsSummary(s: SaleDTO): string {
  if (s.items.length === 0) return "—";
  const first = s.items[0].catalogItem?.name ?? s.items[0].declaredProductName;
  return s.items.length === 1 ? first : `${first} +${s.items.length - 1} más`;
}

function SaleDetail({ s, canPrintGuide }: { s: SaleDTO; canPrintGuide: boolean }) {
  const steps = saleSteps(s);
  return (
    <div className="mt-2.5 border-t border-rule pt-2.5 flex flex-col gap-2">
      <TimelineSteps steps={steps} />
      {canPrintGuide && (
        <a
          href={`/ventas-externas/${s.id}/guia`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-blue underline"
        >
          <Printer size={12} /> Ver / imprimir guía
        </a>
      )}
      {s.isContraEntrega && s.freightCost != null && (
        <div className="text-[10.5px] text-steel">Flete: -${s.freightCost.toFixed(2)} · Monto a transferir: ${(s.totalAmount - s.freightCost).toFixed(2)}</div>
      )}
      {!s.isContraEntrega && s.freightCost != null && (
        <div className="text-[10.5px] text-steel">Monto a transferir: ${s.totalAmount.toFixed(2)} (sin recaudo) · flete (${s.freightCost.toFixed(2)}) pagado aparte al motorizado</div>
      )}
      {s.closeReceivedAmount != null && (
        <div className="text-[10.5px] text-gold">
          Llegó ${s.closeReceivedAmount.toFixed(2)} · diferencia ${(s.totalAmount - s.closeReceivedAmount).toFixed(2)} justificada al cerrar:{" "}
          {s.closeDifferenceReason === "FLETE_MOTORIZADO" ? "flete del motorizado" : "otro motivo"}
          {s.closeDifferenceNote ? ` — ${s.closeDifferenceNote}` : ""}
        </div>
      )}
      <div className="text-[10.5px] text-steel">Entrega a: {s.pickupPersonName}{s.courierNote ? ` · Transportadora: ${s.courierNote}` : ""}</div>
      {s.client && (
        <div className="text-[10.5px] text-steel">
          Cliente: {s.client.name} · {s.client.idNumber ? `${s.client.idType === "RUC" ? "RUC" : "Cédula"}: ${s.client.idNumber} · ` : ""}Cel: {s.client.phone}
          {s.client.email ? ` · Correo: ${s.client.email}` : ""}
          {(s.client.city || s.client.country) ? ` · ${[s.client.city, s.client.country].filter(Boolean).join(", ")}` : ""}
        </div>
      )}
      {s.paymentProofUrl && (
        <a href={s.paymentProofUrl} target="_blank" rel="noreferrer" className="text-[10.5px] font-semibold text-blue underline">
          Ver comprobante de pago{s.paymentProofName ? ` (${s.paymentProofName})` : ""}
        </a>
      )}
      {s.invoiceUrl && (
        <a href={s.invoiceUrl} target="_blank" rel="noreferrer" className="text-[10.5px] font-semibold text-blue underline">
          Ver factura
        </a>
      )}
    </div>
  );
}

function SaleCard({
  s,
  isOpen,
  onToggle,
  canDelete,
  canPrintGuide,
  confirmingDelete,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
  deleting,
  deleteError,
}: {
  s: SaleDTO;
  isOpen: boolean;
  onToggle: () => void;
  canDelete: boolean;
  canPrintGuide: boolean;
  confirmingDelete: boolean;
  onStartDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  deleting: boolean;
  deleteError: string;
}) {
  return (
    <div className="bg-surface border border-rule rounded-md p-2.5">
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        <span className="font-mono text-[10.5px] font-bold text-teal">{s.code}</span>
        <span className="text-[10.5px] text-steel">{s.advisor?.name ?? "—"}</span>
        {s.isContraEntrega && <span className="font-mono text-[8.5px] font-bold uppercase text-blue">Contra entrega</span>}
        {s.deletedAt && <span className="font-mono text-[8.5px] font-bold uppercase text-red">Eliminada</span>}
        {s.returnedAt && <span className="font-mono text-[8.5px] font-bold uppercase text-red">Devuelta</span>}
      </div>
      <div className="text-[12px] font-semibold flex items-center gap-1.5 flex-wrap">
        {s.items.length === 1 && s.items[0].catalogItem && <CatalogCode code={s.items[0].catalogItem.justCode} />}
        <span>{itemsSummary(s)}</span>
      </div>
      <div className="text-[10.5px] text-steel">${s.totalAmount.toFixed(2)} · {formatDateTime(s.createdAt)}</div>
      {s.deletedAt && <div className="text-[10.5px] text-red mt-0.5">Eliminada por admin · {formatDateTime(s.deletedAt)}</div>}
      {s.returnedAt && (
        <div className="text-[10.5px] text-red mt-0.5">
          El cliente no recibió el pedido · {formatDateTime(s.returnedAt)}. Motivo: {s.returnReason}
          {s.returnConfirmedAt
            ? ` — stock reingresado a INVESTOCK (${formatDateTime(s.returnConfirmedAt)})`
            : s.returnReceivedAt
              ? " — Inventario ya la recibió, esperando aprobación de Daniel"
              : " — esperando que Inventario la reciba físicamente"}
        </div>
      )}
      {s.reviewStatus === "REJECTED" && s.rejectionReason && <div className="text-[10.5px] text-red mt-0.5">{s.rejectionReason}</div>}
      {!s.deletedAt && !s.returnedAt && nextActionHint(s) && (
        <div className="text-[10.5px] font-semibold text-gold mt-0.5">{nextActionHint(s)}</div>
      )}

      {!s.deletedAt && s.reviewStatus !== "REJECTED" && (
        <>
          <button
            type="button"
            className="mt-1.5 flex items-center gap-1 text-[10.5px] font-semibold text-blue cursor-pointer"
            onClick={onToggle}
          >
            {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {isOpen ? "Ocultar" : "Ver detalle"}
          </button>
          {isOpen && <SaleDetail s={s} canPrintGuide={canPrintGuide} />}
        </>
      )}

      {!s.deletedAt && canDelete && (
        confirmingDelete ? (
          <div className="bg-cloud rounded-md p-2 mt-1.5">
            <div className="text-[10.5px] font-semibold mb-1.5">¿Eliminar {s.code} por completo? No se puede deshacer.</div>
            {deleteError && <div className="text-red text-[10px] mb-1">{deleteError}</div>}
            <div className="flex gap-1.5">
              <button type="button" className="flex-1 rounded border border-rule px-2 py-1 text-[10.5px] font-semibold cursor-pointer" onClick={onCancelDelete}>Cancelar</button>
              <button type="button" disabled={deleting} className="flex-1 rounded border border-red bg-red px-2 py-1 text-[10.5px] font-bold text-white cursor-pointer disabled:opacity-60" onClick={onConfirmDelete}>
                {deleting ? "Eliminando…" : "Sí, eliminar"}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="mt-1.5 flex items-center gap-1 text-[10.5px] font-semibold text-red cursor-pointer" onClick={onStartDelete}>
            <Trash2 size={11} /> Eliminar
          </button>
        )
      )}
    </div>
  );
}

export function ExternalSaleHistoryList({ canDelete = false, canPrintGuide = false }: { canDelete?: boolean; canPrintGuide?: boolean }) {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  function load() {
    fetch("/api/external-sales/history").then((r) => r.json()).then(setSales).catch(() => setSales([]));
  }
  useEffect(load, []);

  async function confirmDelete(id: string) {
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch(`/api/external-sales/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo eliminar.");
      setConfirmingDeleteId(null);
      load();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "No se pudo eliminar.");
    } finally {
      setDeleting(false);
    }
  }

  if (sales === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (sales.length === 0) return <div className="text-[13px] text-steel">Todavía no hay ventas externas registradas.</div>;

  const active = sales.filter((s) => !s.deletedAt && s.reviewStatus !== "REJECTED");
  const rejected = sales.filter((s) => !s.deletedAt && s.reviewStatus === "REJECTED");
  const deleted = sales.filter((s) => s.deletedAt);

  const columns = [
    ...FLOW_COLUMNS.map((label) => ({ label, sales: active.filter((s) => saleColumn(s) === label) })),
    ...(rejected.length > 0 ? [{ label: "Rechazada", sales: rejected }] : []),
    ...(deleted.length > 0 ? [{ label: "Eliminada", sales: deleted }] : []),
  ];

  return (
    <div>
      <div className="text-[12px] text-steel mb-3">
        Cada columna es un paso del proceso — así se ve de un vistazo cuántas ventas hay en cada uno y cuáles están atrasadas.
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => (
          <div key={col.label} className="shrink-0 w-[260px] flex flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <span className="font-display font-bold text-[12.5px]">{col.label}</span>
              <span className="font-mono text-[11px] tabular-nums text-steel bg-cloud border border-rule rounded-full px-2 py-0.5">{col.sales.length}</span>
            </div>
            <div className="flex flex-col gap-2 min-h-[40px]">
              {col.sales.length === 0 ? (
                <div className="text-[11px] text-steel px-1">—</div>
              ) : (
                col.sales.map((s) => (
                  <SaleCard
                    key={s.id}
                    s={s}
                    isOpen={expanded === s.id}
                    onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
                    canDelete={canDelete}
                    canPrintGuide={canPrintGuide}
                    confirmingDelete={confirmingDeleteId === s.id}
                    onStartDelete={() => { setConfirmingDeleteId(s.id); setDeleteError(""); }}
                    onCancelDelete={() => setConfirmingDeleteId(null)}
                    onConfirmDelete={() => confirmDelete(s.id)}
                    deleting={deleting}
                    deleteError={confirmingDeleteId === s.id ? deleteError : ""}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
