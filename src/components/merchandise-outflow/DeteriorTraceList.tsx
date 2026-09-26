"use client";

import { useEffect, useState } from "react";
import { PackagePlus, Search, Trash2 } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { formatDateTime } from "@/lib/formatDateTime";

type Named = { name: string } | null;

type TraceItem = {
  id: string;
  declaredName: string;
  quantity: number;
  photoUrls: string[];
  damageReasonOther: string | null;
  damageReason: Named;
  catalogItem: { name: string; justCode: string | null } | null;
  batch: { code: string; createdAt: string; submittedAt: string | null; createdBy: Named; supplier: Named; documentPhotoUrls: string[] };
  resolution: "SOLVED_ONSITE" | "WRITE_OFF" | "ESCALATED_TO_PURCHASES" | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedBy: Named;
  purchaseGestionSupplier: Named;
  linkedPurchaseRequestId: string | null;
  expectedCreditAmount: number | null;
  purchaseNoMatchReportedAt: string | null;
  purchaseNoMatchNote: string | null;
  purchaseNoMatchReportedBy: Named;
  purchaseExceptionDecision: "DATA_CORRECTED" | "AUTHORIZED" | "REJECTED" | null;
  purchaseExceptionNote: string | null;
  purchaseExceptionDecidedAt: string | null;
  purchaseExceptionDecidedBy: Named;
  purchaseResolution: "REPLACED" | "CREDIT_ISSUED" | "REJECTED" | null;
  purchaseResolutionNote: string | null;
  rejectionProofUrl?: string | null;
  purchaseResolvedAt: string | null;
  purchaseResolvedBy: Named;
  credit: { amount: number } | null;
  groupedSupplierCredit: { amount: number; _count: { groupedOutflowItems: number } } | null;
  exchangeItem: {
    quantity: number;
    resolution: string | null;
    replacementReceivedAt: string | null;
    replacementReceipts: { quantity: number; receivedAt: string; photoUrls: string[]; note: string | null; receivedBy: Named }[];
    batch: { code: string; submittedAt: string | null };
  } | null;
  sourceReentryItem: { batch: { code: string } } | null;
};

function receivedQty(i: TraceItem): number {
  return (i.exchangeItem?.replacementReceipts ?? []).reduce((s, r) => s + r.quantity, 0);
}

type Tone = "amber" | "green" | "red" | "steel";
type Status = { label: string; tone: Tone; open: boolean };

const TONE_CLASS: Record<Tone, string> = {
  amber: "border-gold/40 text-gold",
  green: "border-green/40 text-green",
  red: "border-red/40 text-red",
  steel: "border-rule text-steel",
};

function statusOf(i: TraceItem): Status {
  if (!i.resolution) return { label: "Esperando decisión de Daniel", tone: "amber", open: true };
  if (i.resolution === "SOLVED_ONSITE") return { label: "Cerrado — solucionado ahí mismo", tone: "green", open: false };
  if (i.resolution === "WRITE_OFF") return { label: "Cerrado — dado de baja", tone: "steel", open: false };
  // Cambio o crédito: en los dos casos hay que devolverle la mercadería al
  // proveedor (sin eso no da el saldo a favor) — pedido de Daniel 2026-09-23.
  if (i.purchaseResolution === "REPLACED" || i.purchaseResolution === "CREDIT_ISSUED") {
    const what = i.purchaseResolution === "REPLACED" ? "cambio" : "crédito";
    // Confirmado 2026-09-24, pedido de Nairoby: un cambio no se cierra hasta
    // que Daniel confirma con foto que llegó el reemplazo.
    if (i.exchangeItem?.batch.submittedAt && i.purchaseResolution === "REPLACED" && !i.exchangeItem.replacementReceivedAt) {
      return { label: `Devuelto (${i.exchangeItem.batch.code}) · esperando el reemplazo (${receivedQty(i)} de ${i.exchangeItem.quantity})`, tone: "amber", open: true };
    }
    if (i.exchangeItem?.batch.submittedAt && i.purchaseResolution === "REPLACED") return { label: `Reemplazo recibido · ${i.exchangeItem.batch.code}`, tone: "green", open: false };
    if (i.exchangeItem?.batch.submittedAt) return { label: `Devuelto al proveedor (${what}) · ${i.exchangeItem.batch.code}`, tone: "green", open: false };
    if (i.exchangeItem) return { label: `En paquete ${i.exchangeItem.batch.code} · falta dejarlo listo`, tone: "amber", open: true };
    return { label: `Proveedor aceptó (${what}) · falta armar el paquete`, tone: "amber", open: true };
  }
  if (i.purchaseResolution === "REJECTED") {
    return { label: i.purchaseExceptionDecision === "REJECTED" ? "Rechazado por admin" : "Proveedor rechazó", tone: "red", open: false };
  }
  if (i.purchaseNoMatchReportedAt && !i.purchaseExceptionDecision) return { label: "Esperando decisión del admin", tone: "amber", open: true };
  if (i.linkedPurchaseRequestId || i.purchaseExceptionDecision === "AUTHORIZED") return { label: "Jariel gestionando con el proveedor", tone: "amber", open: true };
  return { label: "Esperando que Jariel tome el caso", tone: "amber", open: true };
}

function Step({ done, title, when, children }: { done: boolean; title: string; when?: string | null; children?: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${done ? "bg-teal" : "border border-steel"}`} />
      <div className="min-w-0">
        <div className={`text-[11.5px] font-semibold ${done ? "text-ink" : "text-steel"}`}>
          {title}
          {when && <span className="font-normal text-steel-dim"> · {formatDateTime(when)}</span>}
        </div>
        {children && <div className="text-[11px] text-steel">{children}</div>}
      </div>
    </div>
  );
}

const DECISION_LABEL = { SOLVED_ONSITE: "Solucionado ahí mismo", WRITE_OFF: "Dar de baja", ESCALATED_TO_PURCHASES: "Escalado a Compras (Jariel)" } as const;
const EXCEPTION_LABEL = { DATA_CORRECTED: "corrigió el dato — Jariel vuelve a intentar", AUTHORIZED: "autorizó seguir sin compra registrada", REJECTED: "rechazó el reclamo" } as const;

function Timeline({ i, canAct, onPack, canAdminDelete, onDeleted }: { i: TraceItem; canAct: boolean; onPack: () => void; canAdminDelete: boolean; onDeleted: () => void }) {
  const [packing, setPacking] = useState(false);
  const [packError, setPackError] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Solo admin, 2026-09-25 (pedido de Daniel, EG-0042 fue prueba) — ver
  // items/[id]/admin-delete/route.ts: devuelve al stock lo que se restó.
  const deletable = (i.resolution === "WRITE_OFF" || i.resolution === "SOLVED_ONSITE") && !i.exchangeItem && !i.sourceReentryItem && !i.credit && !i.groupedSupplierCredit;
  async function adminDelete() {
    const name = i.catalogItem?.name ?? i.declaredName;
    if (!confirm(`¿Eliminar "${name}" de ${i.batch.code}? Las ${i.quantity} un. vuelven al stock. No se puede deshacer.`)) return;
    setDeleting(true);
    setPackError("");
    try {
      const res = await fetch(`/api/merchandise-outflow/items/${i.id}/admin-delete`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo eliminar.");
      if (data?.warning) alert(data.warning);
      onDeleted();
    } catch (e) {
      setPackError(e instanceof Error ? e.message : "No se pudo eliminar.");
      setDeleting(false);
    }
  }

  async function pack() {
    setPacking(true);
    setPackError("");
    try {
      const res = await fetch(`/api/merchandise-outflow/items/${i.id}/to-exchange`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo armar el paquete.");
      onPack();
    } catch (e) {
      setPackError(e instanceof Error ? e.message : "No se pudo armar el paquete.");
    } finally {
      setPacking(false);
    }
  }

  const escalated = i.resolution === "ESCALATED_TO_PURCHASES";
  const creditAmount = i.credit?.amount ?? i.groupedSupplierCredit?.amount ?? null;
  const creditSharedWith = (i.groupedSupplierCredit?._count.groupedOutflowItems ?? 1) - 1;
  return (
    <div className="flex flex-col gap-1.5 mt-2.5 pl-1">
      <Step done title={`Reportado por ${i.batch.createdBy?.name ?? "—"}`} when={i.batch.submittedAt ?? i.batch.createdAt}>
        {i.quantity} un. · {i.damageReason?.name ?? i.damageReasonOther ?? "Sin motivo"}
        {i.batch.supplier && <> · proveedor sugerido: {i.batch.supplier.name}</>}
        {i.sourceReentryItem && <> · viene de la devolución de cliente {i.sourceReentryItem.batch.code}</>}
        {/* Desde 2026-09-26 un reporte de deterioro puede traer varias fotos. */}
        {i.batch.documentPhotoUrls.length > 1 && (
          <span className="flex gap-1.5 flex-wrap mt-1.5">
            {i.batch.documentPhotoUrls.map((p, n) => (
              <a key={p} href={p} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p} alt={`Foto ${n + 1}`} className="w-12 h-12 object-cover rounded border border-rule" />
              </a>
            ))}
          </span>
        )}
      </Step>
      <Step done={!!i.resolution} title={i.resolution ? `Daniel decidió: ${DECISION_LABEL[i.resolution]}` : "Pendiente: decisión de Daniel"} when={i.resolvedAt}>
        {i.resolutionNote}
      </Step>
      {escalated && (
        <>
          <Step
            done={!!i.purchaseGestionSupplier}
            title={i.purchaseGestionSupplier ? `Jariel confirmó el proveedor: ${i.purchaseGestionSupplier.name}` : "Pendiente: Jariel confirma el proveedor"}
          >
            {i.purchaseGestionSupplier && (i.linkedPurchaseRequestId
              ? <>Compra encontrada{i.expectedCreditAmount != null && <> · crédito estimado ${i.expectedCreditAmount.toFixed(2)}</>}</>
              : "Sin compra registrada con ese proveedor")}
          </Step>
          {(i.purchaseNoMatchReportedAt || i.purchaseExceptionDecision) && (
            <Step
              done={!!i.purchaseExceptionDecision}
              title={i.purchaseExceptionDecision ? `Admin ${EXCEPTION_LABEL[i.purchaseExceptionDecision]}` : `Jariel lo pasó al admin (sin compra que lo respalde)`}
              when={i.purchaseExceptionDecidedAt ?? i.purchaseNoMatchReportedAt}
            >
              {i.purchaseExceptionNote ?? i.purchaseNoMatchNote}
            </Step>
          )}
          <Step
            done={!!i.purchaseResolution}
            title={
              i.purchaseResolution === "REPLACED"
                ? `Resultado: el proveedor CAMBIA el producto (${i.purchaseResolvedBy?.name ?? "—"})`
                : i.purchaseResolution === "CREDIT_ISSUED"
                  ? `Resultado: el proveedor da CRÉDITO${creditAmount != null ? ` de $${creditAmount.toFixed(2)}${creditSharedWith > 0 ? ` junto con ${creditSharedWith} producto(s) más` : ""}` : ""} (${i.purchaseResolvedBy?.name ?? "—"})`
                  : i.purchaseResolution === "REJECTED"
                    ? `Resultado: RECHAZADO (${i.purchaseResolvedBy?.name ?? "—"})`
                    : "Pendiente: respuesta del proveedor"
            }
            when={i.purchaseResolvedAt}
          >
            {i.purchaseResolutionNote}
            {i.rejectionProofUrl && (
              <a href={i.rejectionProofUrl} target="_blank" rel="noopener noreferrer" className="ml-1.5 text-blue font-semibold">Ver captura del rechazo</a>
            )}
          </Step>
          {(i.purchaseResolution === "REPLACED" || i.purchaseResolution === "CREDIT_ISSUED") && (
            <Step
              done={!!i.exchangeItem?.batch.submittedAt}
              title={
                i.exchangeItem?.batch.submittedAt
                  ? `Mercadería devuelta al proveedor: ${i.exchangeItem.batch.code}`
                  : i.exchangeItem
                    ? `En el paquete ${i.exchangeItem.batch.code} — falta la foto de la lista y dejarlo listo`
                    : "Pendiente: armar el paquete de devolución"
              }
              when={i.exchangeItem?.batch.submittedAt}
            >
              {!i.exchangeItem && canAct && (
                <div className="mt-1.5">
                  <button
                    type="button"
                    disabled={packing}
                    className="inline-flex items-center gap-1.5 rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60"
                    onClick={pack}
                  >
                    <PackagePlus size={13} /> {packing ? "Armando…" : "Armar paquete de devolución"}
                  </button>
                  <div className="text-[10.5px] text-steel mt-1">Pasa solo a &quot;Mercadería devuelta al proveedor&quot; con proveedor, producto y cantidad ya puestos.</div>
                  {packError && <div className="text-red text-[11px] mt-1">{packError}</div>}
                </div>
              )}
              {i.exchangeItem && !i.exchangeItem.batch.submittedAt && canAct && (
                <button type="button" className="mt-1 text-[11.5px] font-bold text-teal cursor-pointer" onClick={onPack}>Ir a &quot;Mercadería devuelta al proveedor&quot; →</button>
              )}
            </Step>
          )}
          {i.purchaseResolution === "REPLACED" && i.exchangeItem?.batch.submittedAt && (
            <Step
              done={!!i.exchangeItem.replacementReceivedAt}
              title={
                i.exchangeItem.replacementReceivedAt
                  ? "Llegó el reemplazo en buen estado — sumado al stock"
                  : `Pendiente: que llegue el reemplazo (${receivedQty(i)} de ${i.exchangeItem.quantity} recibidas)`
              }
              when={i.exchangeItem.replacementReceivedAt}
            >
              {i.exchangeItem.replacementReceipts.map((r, idx) => (
                <div key={idx} className="mt-1">
                  {r.quantity} un. confirmadas por {r.receivedBy?.name ?? "—"} · {formatDateTime(r.receivedAt)}
                  {r.note && <> — &quot;{r.note}&quot;</>}
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
              {!i.exchangeItem.replacementReceivedAt && canAct && (
                <button type="button" className="mt-1 text-[11.5px] font-bold text-teal cursor-pointer" onClick={onPack}>Confirmar llegada en &quot;Mercadería devuelta al proveedor&quot; →</button>
              )}
            </Step>
          )}
        </>
      )}
      {canAdminDelete && deletable && (
        <div className="mt-1">
          <button type="button" disabled={deleting} className="inline-flex items-center gap-1 text-[11.5px] font-bold text-red cursor-pointer disabled:opacity-60" onClick={adminDelete}>
            <Trash2 size={12} /> {deleting ? "Eliminando…" : "Eliminar (fue prueba)"}
          </button>
          {packError && <div className="text-red text-[11px] mt-1">{packError}</div>}
        </div>
      )}
    </div>
  );
}

// Confirmado 2026-09-23, pedido de Daniel: seguimiento de solo lectura de
// cada producto reportado como deterioro, de principio a fin — para no
// tener que preguntar por WhatsApp si el proveedor aprobó el reclamo.
// canAct (Daniel) + onGoToExchange (confirmado 2026-09-23, pedido de
// Daniel): botón "Armar paquete de cambio" cuando el proveedor ya aceptó el
// cambio — ver items/[id]/to-exchange/route.ts.
// Confirmado 2026-09-23, reporte de Jariel ("no me sale lo que acabo de
// hacer"): lo que se cierra pasa a "Cerrados", y la lista estaba ordenada
// por fecha de REPORTE — lo recién gestionado quedaba perdido. Ahora se
// ordena por el ÚLTIMO movimiento, se recarga cuando cambia refreshKey
// (Jariel acaba de resolver algo arriba), y Jariel abre en "Todos".
function lastActivity(i: TraceItem): number {
  return Math.max(
    ...[i.batch.submittedAt ?? i.batch.createdAt, i.resolvedAt, i.purchaseNoMatchReportedAt, i.purchaseExceptionDecidedAt, i.purchaseResolvedAt, i.exchangeItem?.replacementReceivedAt]
      .filter((d): d is string => !!d)
      .map((d) => new Date(d).getTime()),
  );
}

export function DeteriorTraceList({
  canAct = false,
  onGoToExchange,
  defaultFilter = "open",
  refreshKey = 0,
  canAdminDelete = false,
}: { canAct?: boolean; onGoToExchange?: () => void; defaultFilter?: "open" | "closed" | "all"; refreshKey?: number; canAdminDelete?: boolean } = {}) {
  const [items, setItems] = useState<TraceItem[] | null>(null);
  const [filter, setFilter] = useState<"open" | "closed" | "all">(defaultFilter);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/merchandise-outflow/deterioro/history")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setItems(Array.isArray(d) ? [...d].sort((a: TraceItem, b: TraceItem) => lastActivity(b) - lastActivity(a)) : []))
      .catch(() => setItems([]));
  }, [refreshKey]);

  if (items === null) return <div className="text-[13px] text-steel">Cargando…</div>;

  const withStatus = items.map((i) => ({ i, s: statusOf(i) }));
  const openCount = withStatus.filter((x) => x.s.open).length;
  const q = query.trim().toLowerCase();
  const visible = withStatus.filter(({ i, s }) => {
    if (filter === "open" && !s.open) return false;
    if (filter === "closed" && s.open) return false;
    if (!q) return true;
    const name = (i.catalogItem?.name ?? i.declaredName).toLowerCase();
    return name.includes(q) || (i.catalogItem?.justCode ?? "").toLowerCase().includes(q) || i.batch.code.toLowerCase().includes(q);
  });

  const chip = (id: typeof filter, label: string) => (
    <button
      type="button"
      className={`rounded-full border px-3 py-1 text-[11.5px] font-semibold cursor-pointer ${filter === id ? "border-teal bg-teal text-navy" : "border-rule text-steel"}`}
      onClick={() => setFilter(id)}
    >
      {label}
    </button>
  );

  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {chip("open", `En curso · ${openCount}`)}
        {chip("closed", `Cerrados · ${items.length - openCount}`)}
        {chip("all", "Todos")}
      </div>
      <div className="flex items-center gap-1.5 mb-3 rounded border border-rule px-2.5 py-1.5">
        <Search size={13} className="text-steel" />
        <input className="flex-1 text-[13px] outline-none bg-transparent" placeholder="Buscar producto, código o EG-…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {visible.length === 0 ? (
        <div className="text-[13px] text-steel">No hay reportes de deterioro en esta vista.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map(({ i, s }) => {
            const photo = i.photoUrls[0] ?? i.batch.documentPhotoUrls[0];
            const isOpen = expanded === i.id;
            return (
              <div key={i.id} className="bg-surface border border-rule rounded-md p-3">
                {/* Nombre completo + estado debajo (no al costado): en celular
                    el estado a la derecha dejaba el nombre cortado a 1 letra
                    — pedido de Daniel 2026-09-23. */}
                <button type="button" className="w-full flex items-start gap-3 text-left cursor-pointer" onClick={() => setExpanded(isOpen ? null : i.id)}>
                  {photo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt={i.catalogItem?.name ?? i.declaredName} className="w-11 h-11 object-cover rounded border border-rule shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    {i.catalogItem && <CatalogCode code={i.catalogItem.justCode} />}
                    <div className="text-[13px] font-semibold break-words">{i.catalogItem?.name ?? i.declaredName}</div>
                    <div className="text-[10.5px] text-steel">
                      {i.batch.code} · {i.quantity} un. · {formatDateTime(i.batch.submittedAt ?? i.batch.createdAt)}
                    </div>
                    <span className={`inline-block mt-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${TONE_CLASS[s.tone]}`}>{s.label}</span>
                  </div>
                </button>
                {isOpen && (
                  <Timeline
                    i={i}
                    canAct={canAct && !!onGoToExchange}
                    onPack={() => onGoToExchange?.()}
                    canAdminDelete={canAdminDelete}
                    onDeleted={() => setItems((prev) => prev?.filter((x) => x.id !== i.id) ?? prev)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
