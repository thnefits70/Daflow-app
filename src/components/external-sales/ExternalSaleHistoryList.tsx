"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatDateTime } from "@/lib/formatDateTime";
import { CatalogCode } from "@/components/shared/CatalogCode";

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
  client: { name: string; idType: "RUC" | "CEDULA"; idNumber: string; phone: string; email: string | null; city: string | null; country: string | null } | null;
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
  createdAt: string;
  advisor: { name: string } | null;
  reviewedAt: string | null;
  reviewedBy: { name: string } | null;
  dispatchAssignedTo: { name: string } | null;
  prepReadyAt: string | null;
  prepReadyBy: { name: string } | null;
  packAssignedAt: string | null;
  packAssignedTo: { name: string } | null;
  deliveredAt: string | null;
  deliveredBy: { name: string } | null;
  deletedAt: string | null;
};

function step(label: string, at: string | null, by: { name: string } | null) {
  return { label, at, by };
}

function saleSteps(s: SaleDTO) {
  return [
    step("Declarada", s.createdAt, s.advisor),
    step("Aprobada", s.reviewedAt, s.reviewedBy),
    step("Pago confirmado", s.paymentConfirmedAt, s.paymentConfirmedBy),
    step("Facturada", s.invoiceUploadedAt, s.invoiceUploadedBy),
    step("Agrupada", s.prepReadyAt, s.prepReadyBy),
    step("Embalaje asignado", s.packAssignedAt, s.packAssignedTo),
    step("Entregada", s.deliveredAt, s.deliveredBy),
    step("Cerrada", s.nairobyClosedAt, null),
  ];
}

// La columna de una venta es el paso más avanzado que ya se cumplió —
// caminando desde "Cerrada" hacia atrás hasta "Declarada". Funciona igual de
// bien en pago anticipado que en contra entrega (donde facturación y pago
// pueden pasar DESPUÉS de la entrega), porque no asume un orden fijo.
function saleColumn(s: SaleDTO): string {
  const steps = saleSteps(s);
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].at) return steps[i].label;
  }
  return "Declarada";
}

function itemsSummary(s: SaleDTO): string {
  if (s.items.length === 0) return "—";
  const first = s.items[0].catalogItem?.name ?? s.items[0].declaredProductName;
  return s.items.length === 1 ? first : `${first} +${s.items.length - 1} más`;
}

const FLOW_COLUMNS = ["Declarada", "Aprobada", "Pago confirmado", "Facturada", "Agrupada", "Embalaje asignado", "Entregada", "Cerrada"];

function SaleDetail({ s }: { s: SaleDTO }) {
  const steps = saleSteps(s);
  return (
    <div className="mt-2.5 border-t border-rule pt-2.5 flex flex-col gap-2">
      <div className="text-[10.5px] text-steel flex flex-col gap-0.5">
        {steps.filter((st) => st.at).map((st) => (
          <div key={st.label}>
            {st.label}{st.by ? ` por ${st.by.name}` : ""} · {formatDateTime(st.at!)}
          </div>
        ))}
      </div>
      <div className="text-[10.5px] text-steel">Entrega a: {s.pickupPersonName}{s.courierNote ? ` · Transportadora: ${s.courierNote}` : ""}</div>
      {s.client && (
        <div className="text-[10.5px] text-steel">
          Cliente: {s.client.name} · {s.client.idType === "RUC" ? "RUC" : "Cédula"}: {s.client.idNumber} · Cel: {s.client.phone}
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

function SaleCard({ s, isOpen, onToggle }: { s: SaleDTO; isOpen: boolean; onToggle: () => void }) {
  return (
    <div className="bg-surface border border-rule rounded-md p-2.5">
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        <span className="font-mono text-[10.5px] font-bold text-teal">{s.code}</span>
        <span className="text-[10.5px] text-steel">{s.advisor?.name ?? "—"}</span>
        {s.isContraEntrega && <span className="font-mono text-[8.5px] font-bold uppercase text-blue">Contra entrega</span>}
        {s.deletedAt && <span className="font-mono text-[8.5px] font-bold uppercase text-red">Eliminada</span>}
      </div>
      <div className="text-[12px] font-semibold flex items-center gap-1.5 flex-wrap">
        {s.items.length === 1 && s.items[0].catalogItem && <CatalogCode code={s.items[0].catalogItem.justCode} />}
        <span>{itemsSummary(s)}</span>
      </div>
      <div className="text-[10.5px] text-steel">${s.totalAmount.toFixed(2)} · {formatDateTime(s.createdAt)}</div>
      {s.deletedAt && <div className="text-[10.5px] text-red mt-0.5">Eliminada por admin · {formatDateTime(s.deletedAt)}</div>}
      {s.reviewStatus === "REJECTED" && s.rejectionReason && <div className="text-[10.5px] text-red mt-0.5">{s.rejectionReason}</div>}

      {!s.deletedAt && s.reviewStatus !== "REJECTED" && (
        <>
          <button
            type="button"
            className="mt-1.5 flex items-center gap-1 text-[10.5px] font-semibold text-blue cursor-pointer"
            onClick={onToggle}
          >
            {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {isOpen ? "Ocultar" : "Ver detalle"}
          </button>
          {isOpen && <SaleDetail s={s} />}
        </>
      )}
    </div>
  );
}

export function ExternalSaleHistoryList() {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/external-sales/history").then((r) => r.json()).then(setSales).catch(() => setSales([]));
  }, []);

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
                  <SaleCard key={s.id} s={s} isOpen={expanded === s.id} onToggle={() => setExpanded(expanded === s.id ? null : s.id)} />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
