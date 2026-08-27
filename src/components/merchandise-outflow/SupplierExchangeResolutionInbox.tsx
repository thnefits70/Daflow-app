"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, DollarSign, ExternalLink, XCircle, Wallet } from "lucide-react";

type ItemDTO = {
  id: string;
  declaredName: string;
  quantity: number;
  catalogItem: { name: string; photos: string[] } | null;
  unitCostAtExchange: number | null;
  expectedCreditAmount: number | null;
  resolution: "REPLACED" | "CREDIT_ISSUED" | "REJECTED" | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedBy: { name: string } | null;
  gestorName: string | null;
  credit: { amount: number } | null;
  financeWriteOffAt: string | null;
  financeWriteOffBy: { name: string } | null;
  justWriteOffConfirmedAt: string | null;
  justWriteOffConfirmedBy: { name: string } | null;
  batch: { id: string; code: string; createdAt: string; documentPhotoUrls: string[]; supplier: { id: string; name: string } | null };
};

type CreditTotal = {
  supplierId: string;
  supplierName: string;
  total: number;
  credits: { id: string; amount: number; batchCode: string; itemName: string; createdAt: string }[];
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function itemName(item: ItemDTO) {
  return item.catalogItem?.name ?? item.declaredName;
}

// Mismo criterio de agrupado que SupplierExchangeMyResolutions — nunca
// mezclar lotes distintos, solo agrupar lo que ya viene junto.
function groupByBatch(items: ItemDTO[]) {
  const order: string[] = [];
  const byBatch = new Map<string, { batch: ItemDTO["batch"]; items: ItemDTO[] }>();
  for (const item of items) {
    if (!byBatch.has(item.batch.id)) {
      order.push(item.batch.id);
      byBatch.set(item.batch.id, { batch: item.batch, items: [] });
    }
    byBatch.get(item.batch.id)!.items.push(item);
  }
  return order.map((id) => byBatch.get(id)!);
}

async function postJson(url: string) {
  const res = await fetch(url, { method: "POST" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

// Confirmado 2026-08-26/27: vista de SOLO LECTURA sobre la decisión en sí
// (quién resuelve cada producto es quien pidió la compra, no Daniel ni
// admin — ver SupplierExchangeMyResolutions). Cuando un ítem queda
// RECHAZADO, sí hay dos acciones puntuales acá: Daniel confirma la baja en
// Just (canConfirmJustWriteOff) y Nairoby confirma la baja financiera
// (canConfirmFinanceWriteOff) — cada una su propia tarea, admin no hace
// ninguna de las dos, solo mira.
export function SupplierExchangeResolutionInbox({
  canConfirmJustWriteOff = false,
  canConfirmFinanceWriteOff = false,
}: {
  canConfirmJustWriteOff?: boolean;
  canConfirmFinanceWriteOff?: boolean;
}) {
  const [items, setItems] = useState<ItemDTO[] | null>(null);
  const [creditTotals, setCreditTotals] = useState<CreditTotal[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/merchandise-outflow/supplier-exchange")
      .then((r) => r.json())
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]));
    fetch("/api/merchandise-outflow/supplier-exchange/credit-totals")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setCreditTotals(Array.isArray(data) ? data : []))
      .catch(() => setCreditTotals([]));
  }
  useEffect(load, []);

  async function confirmFinanceWriteOff(id: string) {
    setConfirming(id);
    setError("");
    try {
      await postJson(`/api/merchandise-outflow/items/${id}/finance-writeoff`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo confirmar.");
    } finally {
      setConfirming(null);
    }
  }

  async function confirmJustWriteOff(id: string) {
    setConfirming(id);
    setError("");
    try {
      await postJson(`/api/merchandise-outflow/items/${id}/just-writeoff-confirm`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo confirmar.");
    } finally {
      setConfirming(null);
    }
  }

  if (items === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (items.length === 0) return <div className="text-[13px] text-steel">No hay solicitudes de cambio con proveedor todavía.</div>;

  const groups = groupByBatch(items);

  return (
    <div className="flex flex-col gap-4 max-w-lg">
      {creditTotals.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {creditTotals.map((t) => (
            <div key={t.supplierId} className="flex items-center gap-2 bg-blue/10 border border-blue/30 rounded-md px-3 py-2">
              <Wallet size={13} className="text-blue shrink-0" />
              <div className="text-[12px] flex-1 min-w-0">
                <span className="font-semibold">{t.supplierName}</span> — crédito ya confirmado:{" "}
                <span className="font-bold text-blue">{money(t.total)}</span>
                <span className="text-steel"> ({t.credits.map((c) => `${money(c.amount)} de ${c.batchCode}`).join(", ")})</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <div className="text-red text-[12px]">{error}</div>}

      {groups.map(({ batch, items: batchItems }) => (
        <div key={batch.id} className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] font-bold text-teal">{batch.code}</span>
            <span className="text-[12px] font-semibold">{batch.supplier?.name ?? "—"}</span>
            <a href={`/cambio-proveedor/${batch.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[10.5px] text-blue font-semibold cursor-pointer">
              <ExternalLink size={10} /> Ver guía
            </a>
          </div>
          {batch.documentPhotoUrls.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {batch.documentPhotoUrls.map((p, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={p} alt={`Evidencia ${i + 1}`} className="w-14 h-14 object-cover rounded border border-rule" />
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            {batchItems.map((item) => (
              <div key={item.id} className="bg-surface border border-rule rounded-md p-3.5">
                <div className="flex items-center gap-3">
                  {item.catalogItem?.photos[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.catalogItem.photos[0]} alt={itemName(item)} className="w-12 h-12 object-cover rounded border border-rule shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold truncate">{itemName(item)}</div>
                    <div className="text-[11px] text-steel">{item.quantity} un.</div>
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
                  ) : item.resolution === "CREDIT_ISSUED" ? (
                    <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-blue">
                      <DollarSign size={12} /> Crédito de {item.credit ? money(item.credit.amount) : "—"} — gestionado por {item.resolvedBy?.name ?? "—"}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-red">
                        <XCircle size={12} /> El proveedor rechazó todo — registrado por {item.resolvedBy?.name ?? "—"}
                      </div>
                      {item.resolutionNote && <div className="text-[11px] text-steel">&quot;{item.resolutionNote}&quot;</div>}
                      <div className="flex flex-col gap-1 mt-0.5">
                        <div className="flex items-center gap-1.5 text-[11px]">
                          {item.financeWriteOffAt ? (
                            <span className="flex items-center gap-1 text-green font-semibold"><CheckCircle2 size={11} /> Baja financiera confirmada por {item.financeWriteOffBy?.name ?? "—"}</span>
                          ) : canConfirmFinanceWriteOff ? (
                            <button type="button" disabled={confirming === item.id} className="rounded border border-teal bg-teal px-2 py-1 text-[10.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={() => confirmFinanceWriteOff(item.id)}>
                              Confirmar baja financiera
                            </button>
                          ) : (
                            <span className="text-steel font-semibold">Falta que Nairoby dé de baja financiera</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px]">
                          {item.justWriteOffConfirmedAt ? (
                            <span className="flex items-center gap-1 text-green font-semibold"><CheckCircle2 size={11} /> Baja en Just confirmada por {item.justWriteOffConfirmedBy?.name ?? "—"}</span>
                          ) : canConfirmJustWriteOff ? (
                            <button type="button" disabled={confirming === item.id} className="rounded border border-teal bg-teal px-2 py-1 text-[10.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={() => confirmJustWriteOff(item.id)}>
                              Confirmar baja en Just
                            </button>
                          ) : (
                            <span className="text-steel font-semibold">Falta que Daniel confirme la baja en Just</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
