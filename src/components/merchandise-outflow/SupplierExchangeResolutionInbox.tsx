"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, DollarSign, ExternalLink, XCircle, Wallet, AlertTriangle, Search, ChevronDown, ChevronRight, Trash2, Printer, Camera, PackageCheck, X } from "lucide-react";
import { LiveCameraCapture } from "@/components/shared/LiveCameraCapture";
import { formatDateTime } from "@/lib/formatDateTime";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { ExpandableName } from "@/components/ui/ExpandableName";

type ItemDTO = {
  id: string;
  declaredName: string;
  quantity: number;
  catalogItem: { name: string; photos: string[]; justCode: string | null } | null;
  unitCostAtExchange: number | null;
  expectedCreditAmount: number | null;
  resolution: "REPLACED" | "CREDIT_ISSUED" | "REJECTED" | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedBy: { name: string } | null;
  gestorName: string | null;
  credit: { amount: number } | null;
  fromDeterioro?: boolean;
  financeWriteOffAt: string | null;
  financeWriteOffBy: { name: string } | null;
  adminReviewedAt: string | null;
  adminReviewedBy: { name: string } | null;
  adminReviewNote: string | null;
  replacementReceivedAt: string | null;
  replacementReceipts: { id: string; quantity: number; photoUrls: string[]; note: string | null; receivedAt: string; receivedBy: { name: string } | null }[];
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

// Confirmado 2026-08-29, pedido explícito del usuario: un ítem queda
// "gestionado" (sale de la lista de pendientes y pasa al historial
// buscable) cuando ya no le falta nada de nadie. REPLACED/CREDIT_ISSUED no
// tienen cadena posterior, quedan cerrados apenas se resuelven. REJECTED sí
// falta la baja financiera de Nairoby — la revisión del admin es aparte y NUNCA
// bloquea el cierre (puede pasar antes, después o nunca).
// Confirmado 2026-09-24, pedido de Nairoby: un cambio (REPLACED) ya no
// queda cerrado cuando el proveedor dice que sí — recién cuando Daniel
// confirma con foto que llegó el reemplazo en buen estado.
function isFullyClosed(item: ItemDTO): boolean {
  if (item.resolution === null) return false;
  if (item.resolution === "REJECTED") return !!item.financeWriteOffAt;
  if (item.resolution === "REPLACED") return !!item.replacementReceivedAt;
  return true;
}

function receivedQty(item: ItemDTO): number {
  return item.replacementReceipts.reduce((s, r) => s + r.quantity, 0);
}

// Daniel confirma la llegada del reemplazo: cuántas llegaron en buen
// estado + foto en vivo. Si llegan menos, pide explicar (avisa a Nairoby y
// Jariel) y el resto sigue pendiente — ver replacement-received/route.ts.
function ReplacementArrivalForm({ item, onDone }: { item: ItemDTO; onDone: () => void }) {
  const missing = item.quantity - receivedQty(item);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(String(missing));
  const [photos, setPhotos] = useState<string[]>([]);
  const [taking, setTaking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const n = Number(qty);
  const partial = Number.isInteger(n) && n > 0 && n < missing;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/merchandise-outflow/items/${item.id}/replacement-received`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: n, photoUrls: photos, note: note.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo guardar.");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="mt-1.5 self-start inline-flex items-center gap-1.5 rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer" onClick={() => setOpen(true)}>
        <PackageCheck size={13} /> Llegó el reemplazo
      </button>
    );
  }
  return (
    <div className="mt-1.5 bg-cloud border border-rule rounded-md p-2.5 flex flex-col gap-2">
      <label className="text-[11px] text-steel flex items-center gap-2">
        ¿Cuántas llegaron en buen estado? (faltan {missing})
        <input type="number" min={1} max={missing} value={qty} onChange={(e) => setQty(e.target.value)} className="w-16 rounded border border-rule bg-transparent px-2 py-1 text-[12px]" />
      </label>
      {photos.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {photos.map((p, idx) => (
            <div key={p} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p} alt={`Foto ${idx + 1}`} className="w-14 h-14 object-cover rounded border border-rule" />
              <button type="button" title="Quitar" className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red text-white flex items-center justify-center cursor-pointer" onClick={() => setPhotos(photos.filter((x) => x !== p))}>
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      {taking ? (
        <LiveCameraCapture
          folder="merchandise-outflow-photos"
          onCaptured={(url) => {
            setPhotos((prev) => [...prev, url]);
            setTaking(false);
          }}
          onCancel={() => setTaking(false)}
        />
      ) : photos.length < 4 ? (
        <button type="button" className="self-start inline-flex items-center gap-1.5 rounded border border-rule px-3 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => setTaking(true)}>
          <Camera size={12} /> {photos.length === 0 ? "Tomar foto del reemplazo" : "Otra foto"}
        </button>
      ) : null}
      {partial && (
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Llegaron menos: ¿qué dijo el proveedor del resto?" className="w-full rounded border border-rule bg-transparent px-2 py-1 text-[11px] resize-none" />
      )}
      <div className="text-[10.5px] text-steel">Cuenta solo las que llegaron en buen estado. Al confirmar, esas unidades se suman al stock.</div>
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={busy || photos.length === 0 || !Number.isInteger(n) || n < 1 || n > missing || (partial && !note.trim())}
          className="rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={submit}
        >
          {busy ? "Guardando…" : "Confirmar llegada"}
        </button>
        <button type="button" disabled={busy} className="rounded border border-rule px-3 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>
      {error && <div className="text-red text-[11px]">{error}</div>}
    </div>
  );
}

function searchHaystack(item: ItemDTO): string {
  return [
    item.batch.code,
    item.batch.supplier?.name,
    itemName(item),
    item.catalogItem?.justCode,
    item.resolutionNote,
    item.adminReviewNote,
    item.gestorName,
    item.resolvedBy?.name,
    item.adminReviewedBy?.name,
    item.financeWriteOffBy?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function closedSummary(item: ItemDTO): { text: string; className: string } {
  if (item.resolution === "REPLACED") return { text: "Reemplazo recibido", className: "text-green" };
  if (item.resolution === "CREDIT_ISSUED") return { text: `Crédito de ${item.credit ? money(item.credit.amount) : "—"}`, className: "text-blue" };
  return { text: "Rechazado — ya dado de baja", className: "text-red" };
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
// RECHAZADO hay dos acciones puntuales acá: Nairoby
// (canConfirmFinanceWriteOff) registra la pérdida financiera — desde
// 2026-09-23 sin esperar a Daniel, porque la mercadería ya se descontó de
// INVESTOCK al armar el paquete. El admin (canReviewAsAdmin) puede revisar
// y dejar un comentario opcional en cualquier momento, puramente
// informativo para el historial, sin bloquear a nadie.
export function SupplierExchangeResolutionInbox({
  canConfirmFinanceWriteOff = false,
  canReviewAsAdmin = false,
  canConfirmReplacementArrival = false,
}: {
  canConfirmFinanceWriteOff?: boolean;
  canReviewAsAdmin?: boolean;
  // Confirmado 2026-09-24: Daniel (canActOnMerchandiseOutflow).
  canConfirmReplacementArrival?: boolean;
}) {
  const [items, setItems] = useState<ItemDTO[] | null>(null);
  const [creditTotals, setCreditTotals] = useState<CreditTotal[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

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

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

  async function confirmAdminReview(id: string) {
    setConfirming(id);
    setError("");
    try {
      const res = await fetch(`/api/merchandise-outflow/items/${id}/admin-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: reviewNotes[id] ?? "" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
      setReviewNotes((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo confirmar.");
    } finally {
      setConfirming(null);
    }
  }

  // Solo admin — ver items/[id]/admin-delete/route.ts.
  async function adminDelete(item: ItemDTO) {
    if (!confirm(`¿Eliminar "${itemName(item)}" de ${item.batch.code}? No se puede deshacer.`)) return;
    setConfirming(item.id);
    setError("");
    try {
      await postJson(`/api/merchandise-outflow/items/${item.id}/admin-delete`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar.");
    } finally {
      setConfirming(null);
    }
  }

  // Mismo bloque de detalle para un ítem, sin importar si aparece en la
  // lista de pendientes o adentro de una fila ya gestionada expandida —
  // así la baja financiera y la revisión del admin se ven igual en
  // los dos lugares, sin duplicar el JSX.
  function renderDetail(item: ItemDTO) {
    if (item.resolution === null) {
      return (
        <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-steel">
          <Clock size={12} /> Pendiente — responsable: {item.gestorName ?? "sin asignar"}
        </div>
      );
    }
    if (item.resolution === "REPLACED") {
      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-green">
            <CheckCircle2 size={12} /> El proveedor aceptó cambiar el producto — registrado por {item.resolvedBy?.name ?? "—"}{item.resolvedAt ? ` · ${formatDateTime(item.resolvedAt)}` : ""}
          </div>
          {item.replacementReceipts.map((r) => (
            <div key={r.id} className="text-[11px]">
              <span className="text-green font-semibold">✓ Llegaron {r.quantity} un. en buen estado</span> — confirmado por {r.receivedBy?.name ?? "—"} · {formatDateTime(r.receivedAt)}
              {r.note && <span className="text-steel"> — &quot;{r.note}&quot;</span>}
              <div className="flex gap-1 mt-1">
                {r.photoUrls.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="Reemplazo recibido" className="w-12 h-12 object-cover rounded border border-rule" />
                  </a>
                ))}
              </div>
            </div>
          ))}
          {!item.replacementReceivedAt && (
            <>
              <div className="flex items-center gap-1.5 text-[11.5px] font-semibold" style={{ color: "var(--color-gold)" }}>
                <Clock size={12} /> Esperando que llegue el reemplazo ({receivedQty(item)} de {item.quantity} recibidas)
              </div>
              {canConfirmReplacementArrival ? (
                <ReplacementArrivalForm item={item} onDone={load} />
              ) : (
                <span className="text-[11px] text-steel">Daniel confirma con foto cuando llegue — recién ahí se cierra y se suma al stock.</span>
              )}
            </>
          )}
        </div>
      );
    }
    if (item.resolution === "CREDIT_ISSUED") {
      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-blue">
            <DollarSign size={12} /> Crédito de {item.credit ? money(item.credit.amount) : "—"} — gestionado por {item.resolvedBy?.name ?? "—"}{item.resolvedAt ? ` · ${formatDateTime(item.resolvedAt)}` : ""}
          </div>
          {item.credit && !item.fromDeterioro && item.expectedCreditAmount !== null && item.credit.amount !== item.expectedCreditAmount && (
            <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-gold" style={{ color: "var(--color-gold)" }}>
              <AlertTriangle size={11} /> Distinto a lo pagado ({money(item.expectedCreditAmount)}) — revisar
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-red">
          <XCircle size={12} /> El proveedor rechazó todo — registrado por {item.resolvedBy?.name ?? "—"}{item.resolvedAt ? ` · ${formatDateTime(item.resolvedAt)}` : ""}
        </div>
        {item.resolutionNote && <div className="text-[11px] text-steel">&quot;{item.resolutionNote}&quot;</div>}

        <div className="flex flex-col gap-1 mt-0.5 pb-1.5 border-b border-rule">
          {item.adminReviewedAt ? (
            <div className="flex items-start gap-1.5 text-[11px]">
              <CheckCircle2 size={11} className="text-green shrink-0 mt-0.5" />
              <div>
                <span className="text-green font-semibold">Revisado por {item.adminReviewedBy?.name ?? "Administrador"}{item.adminReviewedAt ? ` · ${formatDateTime(item.adminReviewedAt)}` : ""}</span>
                {item.adminReviewNote && <div className="text-steel">&quot;{item.adminReviewNote}&quot;</div>}
              </div>
            </div>
          ) : canReviewAsAdmin ? (
            <div className="flex flex-col gap-1">
              <textarea
                value={reviewNotes[item.id] ?? ""}
                onChange={(e) => setReviewNotes((prev) => ({ ...prev, [item.id]: e.target.value }))}
                placeholder="Comentario opcional…"
                rows={2}
                className="w-full rounded border border-rule bg-transparent px-2 py-1 text-[11px] resize-none"
              />
              <button
                type="button"
                disabled={confirming === item.id}
                className="self-start rounded border border-teal bg-teal px-2 py-1 text-[10.5px] font-bold text-navy cursor-pointer disabled:opacity-40"
                onClick={() => confirmAdminReview(item.id)}
              >
                Aceptar esta resolución
              </button>
            </div>
          ) : (
            <span className="text-[11px] text-steel font-semibold">Falta que el admin revise</span>
          )}
        </div>

        <div className="flex flex-col gap-1 mt-0.5">
          <div className="flex items-center gap-1.5 text-[11px]">
            {item.financeWriteOffAt ? (
              <span className="flex items-center gap-1 text-green font-semibold"><CheckCircle2 size={11} /> Baja financiera confirmada por {item.financeWriteOffBy?.name ?? "—"}{item.financeWriteOffAt ? ` · ${formatDateTime(item.financeWriteOffAt)}` : ""}</span>
            ) : canConfirmFinanceWriteOff ? (
              <button type="button" disabled={confirming === item.id} className="rounded border border-teal bg-teal px-2 py-1 text-[10.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={() => confirmFinanceWriteOff(item.id)}>
                Confirmar baja financiera
              </button>
            ) : (
              <span className="text-steel font-semibold">Falta que Nairoby dé de baja financiera</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Los hooks van antes de cualquier return condicional (Cargando… / lista
  // vacía) para que siempre se llamen en el mismo orden — si no, React
  // rompe apenas items pasa de null a un arreglo cargado.
  const closedItems = useMemo(() => {
    if (!items) return [];
    return items.filter(isFullyClosed).sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""));
  }, [items]);

  const filteredClosed = useMemo(() => {
    const q = query.trim().toLowerCase();
    return closedItems.filter((item) => {
      if ((dateFrom || dateTo) && item.resolvedAt) {
        const d = item.resolvedAt.slice(0, 10);
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
      }
      if (!q) return true;
      return searchHaystack(item).includes(q);
    });
  }, [closedItems, query, dateFrom, dateTo]);

  if (items === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (items.length === 0) return <div className="text-[13px] text-steel">No hay mercadería devuelta al proveedor todavía.</div>;

  const pendingItems = items.filter((i) => !isFullyClosed(i));
  const pendingGroups = groupByBatch(pendingItems);

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

      {pendingGroups.length === 0 ? (
        <div className="text-[12.5px] text-steel">Todo gestionado — no hay nada pendiente ahora mismo.</div>
      ) : (
        pendingGroups.map(({ batch, items: batchItems }) => (
          <div key={batch.id} className="bg-surface border border-rule rounded-md p-3.5 flex flex-col gap-3">
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

            <div className="flex flex-col divide-y divide-rule">
              {batchItems.map((item) => (
                <div key={item.id} className="pt-3 first:pt-0">
                  <div className="flex items-center gap-3">
                    {item.catalogItem?.photos[0] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.catalogItem.photos[0]} alt={itemName(item)} className="w-12 h-12 object-cover rounded border border-rule shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold flex items-center gap-1.5 min-w-0">
                        {item.catalogItem && <CatalogCode code={item.catalogItem.justCode} />}
                        <ExpandableName text={itemName(item)} />
                      </div>
                      <div className="text-[11px] text-steel">{item.quantity} un.</div>
                      {item.expectedCreditAmount !== null ? (
                        <div className="text-[10.5px] text-steel mt-0.5">
                          Pagado: <span className="font-semibold text-ink">{money(item.unitCostAtExchange!)}/un.</span> · crédito estimado: <span className="font-semibold text-blue">{money(item.expectedCreditAmount)}</span>
                        </div>
                      ) : (
                        <div className="text-[10.5px] text-green mt-0.5">Sin historial de compra a este proveedor.</div>
                      )}
                    </div>
                  </div>

                  <div className="mt-2.5 pt-2.5 border-t border-rule">{renderDetail(item)}</div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {closedItems.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mt-1">Gestionados ({closedItems.length})</div>

          <div className="flex items-center gap-2 flex-wrap text-[11.5px]">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-steel" />
              <input
                type="text"
                placeholder="Buscar producto, código o proveedor…"
                className="rounded border border-rule bg-cloud pl-7 pr-2.5 py-1.5 w-56"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-1.5 text-steel">
              Desde
              <input type="date" className="rounded border border-rule bg-cloud px-2 py-1.5" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label className="flex items-center gap-1.5 text-steel">
              Hasta
              <input type="date" className="rounded border border-rule bg-cloud px-2 py-1.5" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            {(dateFrom || dateTo || query) && (
              <button type="button" className="text-steel underline cursor-pointer" onClick={() => { setQuery(""); setDateFrom(""); setDateTo(""); }}>
                Limpiar
              </button>
            )}
            <span className="font-mono text-[10px] text-steel ml-auto">{filteredClosed.length} de {closedItems.length}</span>
          </div>

          {filteredClosed.length === 0 ? (
            <div className="text-[11.5px] text-steel border border-dashed border-rule rounded-md p-3 text-center">Nada coincide con esa búsqueda o rango de fechas.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {filteredClosed.map((item) => {
                const isOpen = expanded.has(item.id);
                const summary = closedSummary(item);
                return (
                  <div key={item.id}>
                    <button
                      type="button"
                      className="w-full text-left bg-surface border border-rule rounded-md px-3 py-2 flex items-center gap-2 cursor-pointer hover:border-teal"
                      onClick={() => toggleExpanded(item.id)}
                    >
                      <span className="font-mono text-[10px] font-bold text-teal shrink-0">{item.batch.code}</span>
                      {item.catalogItem && <CatalogCode code={item.catalogItem.justCode} />}
                      <ExpandableName text={itemName(item)} className="text-[12px] font-semibold flex-1" />
                      <span className={`text-[10.5px] font-semibold shrink-0 ${summary.className}`}>{summary.text}</span>
                      <span className="text-[10px] text-steel-dim shrink-0 hidden sm:inline">{item.resolvedAt ? formatDateTime(item.resolvedAt) : ""}</span>
                      {isOpen ? <ChevronDown size={13} className="text-steel shrink-0" /> : <ChevronRight size={13} className="text-steel shrink-0" />}
                    </button>
                    {isOpen && (
                      <div className="border border-t-0 border-rule rounded-b-md px-3 py-2.5 bg-surface">
                        <div className="text-[11px] text-steel mb-1.5">{item.batch.supplier?.name ?? "—"} · {item.quantity} un.</div>
                        {renderDetail(item)}
                        {/* Confirmado 2026-09-24, pedido de Nairoby: volver a imprimir la
                            guía de un paquete ya gestionado, por si hace falta. */}
                        <a href={`/cambio-proveedor/${item.batch.id}`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[10.5px] font-semibold text-blue cursor-pointer">
                          <Printer size={11} /> Ver / imprimir guía {item.batch.code}
                        </a>
                        {canReviewAsAdmin && !item.credit && (
                          <button
                            type="button"
                            disabled={confirming === item.id}
                            className="mt-2 inline-flex items-center gap-1 text-[10.5px] font-semibold text-red cursor-pointer disabled:opacity-40"
                            onClick={() => adminDelete(item)}
                          >
                            <Trash2 size={11} /> Eliminar (era una prueba)
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
