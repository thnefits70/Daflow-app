"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, DollarSign, ExternalLink } from "lucide-react";

type ItemDTO = {
  id: string;
  declaredName: string;
  quantity: number;
  catalogItem: { name: string; photos: string[] } | null;
  unitCostAtExchange: number | null;
  expectedCreditAmount: number | null;
  resolution: "REPLACED" | "CREDIT_ISSUED" | null;
  resolvedAt: string | null;
  resolvedBy: { name: string } | null;
  gestorName: string | null;
  credit: { amount: number } | null;
  batch: { id: string; code: string; createdAt: string; supplier: { id: string; name: string } | null };
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function itemName(item: ItemDTO) {
  return item.catalogItem?.name ?? item.declaredName;
}

// Confirmado 2026-08-26, pedido explícito del usuario: vista de SOLO
// LECTURA para Daniel y admin — quien resuelve cada producto (cambio o
// crédito) ya no es Daniel, es quien solicitó esa compra originalmente (o
// Bryan si no hay compra vinculada), desde /area/cambio-proveedor-gestiones.
// Acá solo se ve el estado y quién es el responsable, para la trazabilidad.
export function SupplierExchangeResolutionInbox() {
  const [items, setItems] = useState<ItemDTO[] | null>(null);

  function load() {
    fetch("/api/merchandise-outflow/supplier-exchange")
      .then((r) => r.json())
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]));
  }
  useEffect(load, []);

  if (items === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (items.length === 0) return <div className="text-[13px] text-steel">No hay solicitudes de cambio con proveedor todavía.</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      {items.map((item) => (
        <div key={item.id} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="flex items-center gap-3">
            {item.catalogItem?.photos[0] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.catalogItem.photos[0]} alt={itemName(item)} className="w-12 h-12 object-cover rounded border border-rule shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold truncate">{itemName(item)}</div>
              <div className="text-[11px] text-steel">{item.quantity} un. · {item.batch.supplier?.name ?? "—"}</div>
              <div className="flex items-center gap-1.5 text-[10.5px] text-steel">
                <span>{item.batch.code}</span>
                <a href={`/cambio-proveedor/${item.batch.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-blue font-semibold cursor-pointer">
                  <ExternalLink size={10} /> Ver guía
                </a>
              </div>
              {item.expectedCreditAmount !== null ? (
                <div className="text-[10.5px] text-steel mt-0.5">
                  Pagado: <span className="font-semibold text-ink">{money(item.unitCostAtExchange!)}/un.</span> · crédito estimado: <span className="font-semibold text-blue">{money(item.expectedCreditAmount)}</span>
                </div>
              ) : (
                <div className="text-[10.5px] text-steel mt-0.5">Sin historial de compra a este proveedor.</div>
              )}
            </div>
          </div>

          <div className="mt-2.5 pt-2.5 border-t border-rule">
            {item.resolution === null ? (
              <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-steel">
                <Clock size={12} /> Pendiente — responsable: {item.gestorName ?? "sin asignar"}
              </div>
            ) : item.resolution === "REPLACED" ? (
              <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-green">
                <CheckCircle2 size={12} /> El proveedor cambió el producto — resuelto por {item.resolvedBy?.name ?? "—"}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-blue">
                <DollarSign size={12} /> Crédito de {item.credit ? money(item.credit.amount) : "—"} — gestionado por {item.resolvedBy?.name ?? "—"}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
