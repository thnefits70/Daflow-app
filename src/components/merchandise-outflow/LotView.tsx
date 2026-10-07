"use client";

import { Fragment, useState } from "react";
import { B2BAdvisorName } from "@/components/shared/B2BAdvisorName";
import { ArrowUp, CheckCircle2, ChevronDown, ChevronUp, ChevronsUpDown, Package, Printer, X } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { areaGroupCount, carrierLabel, lineBlock, newAreaGroup, sortByBlock, sortCarriers } from "@/lib/carriers";
import { areaLabel } from "@/lib/warehouseAreas";
import { brandLabel, sortBrands } from "@/lib/brandLabels";
import { BlockAssignee } from "./BlockAssignee";
import { sourceLabel, type VariantNote } from "./fulfillmentRequestShared";
import { PickingPanel } from "./PickingPanel";
import { GuideHoldsBox } from "./GuideHoldsBox";
import { LotComboRecipe, type LotComboRecipe as ComboRecipe } from "./LotComboRecipe";

type ItemView = { catalogItemId: string; name: string; photos: string[]; justCode: string | null; area?: string | null };
export type LotLine = ItemView & { quantity: number; byCarrier: Record<string, number>; fromCombos: { code: string; quantity: number }[]; variants: (VariantNote & { byCarrier?: Record<string, number> })[] };
export type LotWarrantyLine = ItemView & {
  itemId: string;
  guide: string;
  carrier: string;
  quantity: number;
  mode: string;
  piece: string | null;
  fromComboCode: string | null;
  pieceConfirmedAt: string | null;
};
export type LotPickLine = ItemView & {
  needed: number;
  normalNeeded: number;
  warrantyNeeded: number;
  picked: number | null;
  pickedByName: string | null;
  pickedAt: string | null;
  confirmedQty: number | null;
  confirmedAt: string | null;
  confirmedByName: string | null;
  block: string;
  // Stock por variante (2026-10-06): lo que salió "Sin variante" en las guías.
  noVariantUnits?: number;
  variantOptions?: string[];
  variantPicked?: { name: string; qty: number }[] | null;
};
export type LotBlock = { carrier: string; assigneeId: string | null; assigneeName: string | null; assignedByName?: string | null; assignedAt: string | null };
// ID provisional de ALF (temporal, 2026-09-28): no está en INVESTOCK.
export type ProvisionalLotLine = { code: string; name: string; quantity: number; byCarrier: Record<string, number>; variants: string[] };
export type LotShortage = ItemView & { needed: number; stock: number; pendingReturns: { label: string; qty: number }[]; realShortage: number };
export type LotBatch = { id: string; source: string; requestedAt: string; requestedByName: string; guideCount: number; fileCount: number };
export type LotStatus = "DRAFT" | "SENT" | "CLOSED";
export type CompiledLot = {
  id: string;
  day: string;
  corte: number;
  status: LotStatus;
  sentAt: string | null;
  sentByName: string | null;
  carriers: string[];
  guidesByCarrier: Record<string, number>;
  // plataforma (DROPI/ROCKET) → transportadora → guías
  guidesBySource: Record<string, Record<string, number>>;
  // marca (MKT_…/ROCKET/SIN_MARCA) → transportadora → guías; null en cortes
  // subidos antes de guardar los productos de cada guía.
  guidesByBrand?: Record<string, Record<string, number>> | null;
  batches: LotBatch[];
  lines: LotLine[];
  provisional?: ProvisionalLotLine[];
  // Producto dado de baja que igual se vendió en Dropi (2026-09-30): no sale.
  discontinued?: { code: string; name: string; quantity: number; guideNumbers: string[]; carriers: string[] }[];
  warranty: LotWarrantyLine[];
  combos: ComboRecipe[];
  shortages: LotShortage[];
  manifestNumber: number | null;
  printedAt: string | null;
  printedByName: string | null;
  closedAt: string | null;
  // Manifiesto atrasado (2026-09-29): ya salió, Daniel lo confirma de una vez.
  backfill?: boolean;
  // Productos con conteo físico después del día del manifiesto: no se descuentan.
  countedAfter?: (ItemView & { countedAt: string })[];
  picking: LotPickLine[];
  blocks: LotBlock[];
  // team: solo le llega a Daniel (para asignar bloques).
  viewer?: { canPrint: boolean; canPick: boolean; pickScope?: "ALL" | "ASSIGNED" | null; canConfirm: boolean; canAssign?: boolean; userId: string | null; team?: { id: string; name: string }[] };
};
export type LotListItem = { id: string; day: string; corte: number; status: LotStatus; createdAt: string; backfill?: boolean; sentAt: string | null; uploads: number; guides: number; unassignedBlocks: number; unscanned: number };

export function fmtDay(day: string) {
  // Mediodía UTC: evita que la zona horaria del navegador corra la fecha un día.
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit", timeZone: "America/Guayaquil" });
}

function fmtDateShort(iso: string) {
  return new Date(iso).toLocaleDateString("es-EC", { day: "2-digit", month: "2-digit", timeZone: "America/Guayaquil" });
}

const STATUS_LABEL: Record<LotStatus, string> = { DRAFT: "En preparación", SENT: "Enviado a Inventario", CLOSED: "Cerrado" };
const STATUS_STYLE: Record<LotStatus, string> = {
  DRAFT: "bg-gold/15 border-gold/40",
  SENT: "bg-teal/10 border-teal/35 text-teal",
  CLOSED: "bg-navy/5 border-rule text-steel",
};

function Thumb({ url }: { url: string | undefined }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="w-7 h-7 object-cover rounded border border-rule shrink-0" />
  ) : (
    <div className="w-7 h-7 rounded border border-dashed border-rule shrink-0 flex items-center justify-center text-steel">
      <Package size={12} />
    </div>
  );
}

export function manifestCode(n: number): string {
  return `MF-${String(n).padStart(4, "0")}`;
}

function warrantyText(w: LotWarrantyLine) {
  if (w.mode === "PIECE") return `Solo pieza: ${w.piece}`;
  if (w.mode === "PIECE_STOCK") return `Solo pieza: ${w.piece} (se descuenta el producto)`;
  const variant = w.piece ? ` · ${w.piece}` : "";
  if (w.mode === "PARTIAL") return `Solo esta parte del combo${variant}`;
  return `Completo${variant}`;
}

// Confirmado 2026-09-23 (diseño acordado con el usuario): un corte junta
// todo lo que Yair subió para ese horario, sumado por ID madre de
// INVESTOCK y repartido por transportadora. Mientras está "En preparación"
// Yair puede quitar una subida equivocada; al enviarlo a Inventario (doble
// confirmación) queda cerrado para cambios y Daniel recibe el aviso.
export function LotView({
  lot,
  canSubmit,
  onOpenBatch,
  onChanged,
  onDeleted,
}: {
  lot: CompiledLot;
  canSubmit: boolean;
  onOpenBatch: (id: string) => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [openCombo, setOpenCombo] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const provisional = lot.provisional ?? [];
  const isEmpty = lot.lines.length === 0 && lot.warranty.length === 0 && provisional.length === 0;
  const shownCombo = lot.combos.find((c) => c.code === openCombo) ?? null;
  const units = lot.lines.reduce((s, l) => s + l.quantity, 0);
  const perCarrier = lot.carriers.map((c) => ({ c, q: lot.lines.reduce((s, l) => s + (l.byCarrier[c] ?? 0), 0), g: lot.guidesByCarrier[c] ?? 0 }));
  const totalGuides = Object.values(lot.guidesByCarrier).reduce((s, n) => s + n, 0);
  const editable = lot.status === "DRAFT" && canSubmit;
  // Mismo orden que el manifiesto impreso: por bloque (la transportadora que
  // se va primero) y dentro de cada uno de mayor a menor.
  const lines = sortByBlock(lot.lines);
  const blockOrder = [...new Set(lines.map((l) => lineBlock(l.byCarrier)))];
  // Pedido del equipo vía Daniel 2026-09-29: la flecha junto a cada
  // transportadora sube arriba todos sus productos; el ✓ dice que de esa
  // transportadora ya se sacó todo (lo registrado en "Sacar y confirmar").
  const [upCarrier, setUpCarrier] = useState<string | null>(null);
  const taken = new Set(lot.picking.filter((p) => p.picked !== null || p.confirmedAt).map((p) => p.catalogItemId));
  const carrierDone = (c: string) => {
    const rows = lot.lines.filter((l) => (l.byCarrier[c] ?? 0) > 0);
    return lot.status !== "DRAFT" && !lot.backfill && rows.length > 0 && rows.every((l) => taken.has(l.catalogItemId));
  };
  const upLines = upCarrier ? lines.filter((l) => (l.byCarrier[upCarrier] ?? 0) > 0).sort((a, b) => (b.byCarrier[upCarrier] ?? 0) - (a.byCarrier[upCarrier] ?? 0)) : [];
  const shownLines = upCarrier ? [...upLines, ...lines.filter((l) => !((l.byCarrier[upCarrier] ?? 0) > 0))] : lines;

  async function removeBatch(id: string) {
    if (!window.confirm("¿Quitar esta subida del corte? Sus guías quedan libres para volver a subirlas.")) return;
    const res = await fetch(`/api/fulfillment-requests/${id}`, { method: "DELETE" });
    const json = await res.json().catch(() => null);
    if (!res.ok) setErr(json?.error ?? "No se pudo quitar.");
    onChanged();
  }

  async function removeLot() {
    if (!window.confirm(`¿Eliminar el Corte ${lot.corte} (${fmtDay(lot.day)})? No tiene productos; sus subidas vacías también se quitan.`)) return;
    const res = await fetch(`/api/fulfillment-lots/${lot.id}`, { method: "DELETE" });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo eliminar.");
      return;
    }
    onDeleted();
  }

  // Parte 2 (plan acordado con el usuario): Daniel imprime el corte → queda
  // registrado como Manifiesto DAFLOW (MF-0001…) y se abre la hoja lista
  // para imprimir. La ventana se abre antes de llamar al servidor para que
  // el navegador no la bloquee como ventana emergente.
  async function print() {
    setErr("");
    const win = window.open("about:blank", "_blank");
    const res = await fetch(`/api/fulfillment-lots/${lot.id}/print`, { method: "POST" });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      win?.close();
      setErr(json?.error ?? "No se pudo imprimir.");
      return;
    }
    if (win) win.location.href = `/manifiesto/${lot.id}`;
    else window.location.href = `/manifiesto/${lot.id}`;
    if (!lot.printedAt) onChanged();
  }

  async function send() {
    setSending(true);
    setErr("");
    const res = await fetch(`/api/fulfillment-lots/${lot.id}/send`, { method: "POST" });
    const json = await res.json().catch(() => null);
    setSending(false);
    setConfirming(false);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo enviar.");
      return;
    }
    onChanged();
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-4 mb-5">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span className="font-display font-bold text-[14.5px]">
          Corte {lot.corte} · <span className="capitalize">{fmtDay(lot.day)}</span>
        </span>
        <span className={`font-mono text-[9.5px] font-bold uppercase rounded-full px-2 py-0.5 border ${STATUS_STYLE[lot.status]}`}>{lot.backfill && lot.status === "SENT" ? "Por confirmar" : STATUS_LABEL[lot.status]}</span>
        {lot.backfill && <span className="font-mono text-[9.5px] font-bold uppercase rounded-full px-2 py-0.5 border bg-gold/15 border-gold/40">Manifiesto atrasado</span>}
        {lot.manifestNumber && <span className="font-mono text-[11px] font-bold">{manifestCode(lot.manifestNumber)}</span>}
        {lot.status !== "DRAFT" && !lot.backfill && lot.viewer?.canPrint && (
          // Opcional desde 2026-09-26 (pedido de Daniel): se saca desde el celular.
          <button type="button" className="ml-auto flex items-center gap-1.5 rounded border border-rule px-3 py-1.5 text-[12px] font-semibold text-steel hover:text-teal cursor-pointer" onClick={print}>
            <Printer size={13} /> {lot.printedAt ? "Reimprimir hoja" : "Imprimir hoja (opcional)"}
          </button>
        )}
      </div>
      <div className="text-[11.5px] text-steel mb-2">
        {totalGuides > 0 ? `${totalGuides} guías · ` : ""}
        {lot.lines.length} productos · {units} unidades
        {lot.warranty.length > 0 ? ` · ${lot.warranty.length} garantía(s)` : ""}
        {provisional.length > 0 ? ` · ${provisional.length} con ID provisional` : ""}
        {lot.sentAt ? ` · ${lot.backfill ? "cargado" : "enviado"} ${lot.backfill ? fmtDateShort(lot.sentAt) + " " : ""}${fmtTime(lot.sentAt)}${lot.sentByName ? ` por ${lot.sentByName}` : ""}` : ""}
        {lot.printedAt ? ` · impreso ${fmtTime(lot.printedAt)}${lot.printedByName ? ` por ${lot.printedByName}` : ""}` : ""}
      </div>

      {totalGuides > 0 && <GuideCounts lot={lot} />}

      <div className="flex flex-wrap gap-1.5 mb-3">
        {lot.batches.map((b) => (
          <span key={b.id} className="text-[10.5px] rounded-full border border-rule px-2 py-0.5 text-steel flex items-center gap-1.5">
            <button type="button" className="hover:text-teal cursor-pointer" onClick={() => onOpenBatch(b.id)} title="Ver esta subida">
              {fmtTime(b.requestedAt)} · {sourceLabel(b.source)}
              {b.guideCount > 0 ? ` · ${b.guideCount} guías` : ""} · {b.requestedByName}
            </button>
            {editable && (
              <button type="button" className="hover:text-red cursor-pointer" onClick={() => removeBatch(b.id)} title="Quitar esta subida">
                <X size={11} />
              </button>
            )}
          </span>
        ))}
      </div>

      {lot.shortages.length > 0 && (
        <div className="text-[11.5px] bg-red/10 border border-red/30 rounded-md p-2.5 mb-3">
          <div className="font-semibold text-red mb-1">Stock insuficiente en INVESTOCK ({lot.shortages.length})</div>
          {lot.shortages.map((s) => (
            <div key={s.catalogItemId} className="mb-1">
              <div className="flex items-center gap-1.5">
                <CatalogCode code={s.justCode} />
                <span className="flex-1 min-w-0">{s.name}</span>
                <span className="font-mono">
                  piden {s.needed} · hay {s.stock}
                </span>
              </div>
              {s.pendingReturns.map((p) => (
                <div key={p.label} className="text-[11px] pl-2" style={{ color: "var(--color-gold)" }}>
                  ↳ {p.qty} en {p.label} — ingrésalas para que cuenten en el stock
                </div>
              ))}
            </div>
          ))}
          <div className="text-[10.5px] text-steel mt-1">
            {lot.backfill
              ? "Manifiesto atrasado: al confirmarlo, estos productos quedan con menos de 0 en INVESTOCK. Conviene revisar si falta ingresar alguna compra o devolución."
              : lot.status === "DRAFT"
                ? "Al enviar el corte, Daniel recibe este aviso; a Bryan Ríos y Jariel solo les llega lo que falta aun contando las devoluciones sin ingresar."
                : "Daniel ya recibió este aviso; a Bryan Ríos y Jariel les llegó solo lo que falta de verdad."}
          </div>
        </div>
      )}

      {lot.lines.length > 0 && (
        // Pedido del usuario 2026-09-26: el detalle por producto viene
        // cerrado — Inventario y Fulfillment trabajan con el escáner y solo
        // lo abren con un clic cuando lo necesitan.
        <button
          type="button"
          className="flex items-center gap-1.5 w-full rounded border border-rule px-3 py-2 mb-3 text-[12px] font-semibold text-steel hover:text-teal hover:border-teal cursor-pointer"
          onClick={() => setShowDetail((s) => !s)}
        >
          {showDetail ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {showDetail ? "Ocultar detalle del corte" : `Ver detalle del corte (${lot.lines.length} productos)`}
        </button>
      )}

      {lot.lines.length > 0 && showDetail && (
        <div className="overflow-x-auto mb-3">
          <table className="w-full text-[11.5px] border-collapse">
            <thead>
              <tr className="text-left text-steel border-b border-rule">
                <th className="py-1 pr-2 font-semibold">ID</th>
                <th className="py-1 pr-2 font-semibold">Producto</th>
                {lot.carriers.map((c) => (
                  <th key={c} className="py-1 px-1.5 font-semibold text-right whitespace-nowrap">
                    <button
                      type="button"
                      aria-pressed={upCarrier === c}
                      title={`Subir arriba los productos de ${carrierLabel(c)}`}
                      className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 cursor-pointer ${upCarrier === c ? "bg-teal text-navy" : "hover:text-teal"}`}
                      onClick={() => setUpCarrier((u) => (u === c ? null : c))}
                    >
                      {carrierDone(c) && <CheckCircle2 size={11} className={upCarrier === c ? "" : "text-green"} />}
                      {carrierLabel(c)}
                      {upCarrier === c ? <ArrowUp size={11} /> : <ChevronsUpDown size={11} className="opacity-60" />}
                    </button>
                  </th>
                ))}
                <th className="py-1 pl-1.5 font-semibold text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {shownLines.map((l, i) => (
                <Fragment key={l.catalogItemId}>
                  {upCarrier && (i === 0 || i === upLines.length) && (
                    <tr>
                      <td colSpan={lot.carriers.length + 3} className="pt-3 pb-1 border-b border-teal/50">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-bold uppercase tracking-wider">
                            {i === 0 ? `Van por ${carrierLabel(upCarrier)}` : "Resto del corte"}
                          </span>
                          {i === 0 && (
                            <span className="text-[10.5px] text-steel">
                              {upLines.length} productos · {upLines.reduce((s, x) => s + (x.byCarrier[upCarrier] ?? 0), 0)} u
                              {lot.status !== "DRAFT" && !lot.backfill ? ` · ${upLines.filter((x) => taken.has(x.catalogItemId)).length}/${upLines.length} sacados` : ""}
                            </span>
                          )}
                          {i === 0 && (
                            <button type="button" className="ml-auto text-[10.5px] font-semibold text-steel hover:text-teal cursor-pointer" onClick={() => setUpCarrier(null)}>
                              Quitar filtro
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  {!upCarrier && (i === 0 || lineBlock(lines[i - 1].byCarrier) !== lineBlock(l.byCarrier)) && (
                    <tr>
                      <td colSpan={lot.carriers.length + 3} className="pt-3 pb-1 border-b border-teal/50">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-bold uppercase tracking-wider">
                            {blockOrder.indexOf(lineBlock(l.byCarrier)) + 1}° · Lleva {carrierLabel(lineBlock(l.byCarrier))}
                          </span>
                          <span className="text-[10.5px] text-steel">
                            {lines.filter((x) => lineBlock(x.byCarrier) === lineBlock(l.byCarrier)).length} productos ·{" "}
                            {lines.filter((x) => lineBlock(x.byCarrier) === lineBlock(l.byCarrier)).reduce((s, x) => s + x.quantity, 0)} u
                          </span>
                          {lot.status !== "DRAFT" && !lot.backfill && <BlockAssignee lot={lot} carrier={lineBlock(l.byCarrier)} onChanged={onChanged} />}
                        </div>
                      </td>
                    </tr>
                  )}
                  {!upCarrier && newAreaGroup(lines, i) && (
                    <tr>
                      <td colSpan={lot.carriers.length + 3} className="pt-2 pb-0.5 text-[10.5px] font-bold text-gold">
                        {areaLabel(l.area)} · {areaGroupCount(lines, i)} productos
                      </td>
                    </tr>
                  )}
                <tr className="border-b border-rule/60 align-top">
                  <td className="py-1.5 pr-2 font-mono whitespace-nowrap">{l.justCode ?? "—"}</td>
                  <td className="py-1.5 pr-2">
                    <div className="flex items-start gap-2">
                      <Thumb url={l.photos[0]} />
                      <div className="min-w-0">
                        <div>
                          {l.name}
                          {taken.has(l.catalogItemId) && <CheckCircle2 size={11} className="inline ml-1 text-green align-[-1px]" aria-label="ya sacado" />}
                        </div>
                        {l.variants.length > 0 && <div className="text-[10.5px] text-steel">{l.variants.map((v) => `${v.label} ${v.quantity}`).join(" · ")}</div>}
                        {l.fromCombos.length > 0 && (
                          // Toca un combo para ver (y corregir) su receta.
                          <div className="text-[10.5px] text-steel flex flex-wrap gap-x-2">
                            <span>Sale de:</span>
                            {l.fromCombos.map((fc) => {
                              const c = lot.combos.find((x) => x.code === fc.code);
                              return (
                                <button key={fc.code} type="button" className="underline decoration-dotted hover:text-teal cursor-pointer text-left" onClick={() => setOpenCombo(fc.code)}>
                                  combo {fc.code}
                                  {c?.label ? ` ${c.label}` : ""} ({fc.quantity})
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  {lot.carriers.map((c) => (
                    <td key={c} className="py-1.5 px-1.5 text-right font-mono">
                      {l.byCarrier[c] ?? "–"}
                    </td>
                  ))}
                  <td className="py-1.5 pl-1.5 text-right font-mono font-bold text-teal">{l.quantity}</td>
                </tr>
                </Fragment>
              ))}
              <tr className="border-t-2 border-rule font-bold">
                <td className="py-1.5 pr-2" colSpan={2}>
                  Unidades
                </td>
                {perCarrier.map((p) => (
                  <td key={p.c} className="py-1.5 px-1.5 text-right font-mono">
                    {p.q}
                  </td>
                ))}
                <td className="py-1.5 pl-1.5 text-right font-mono text-teal">{units}</td>
              </tr>
              <tr className="font-bold">
                <td className="py-1.5 pr-2" colSpan={2}>
                  Guías
                </td>
                {perCarrier.map((p) => (
                  <td key={p.c} className="py-1.5 px-1.5 text-right font-mono">
                    {p.g}
                  </td>
                ))}
                <td className="py-1.5 pl-1.5 text-right font-mono text-teal">{totalGuides}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {shownCombo && (
        <LotComboRecipe
          key={shownCombo.code}
          lotId={lot.id}
          combo={shownCombo}
          editable={editable}
          onClose={() => setOpenCombo(null)}
          onSaved={() => {
            setOpenCombo(null);
            onChanged();
          }}
        />
      )}

      {lot.warranty.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] font-semibold text-steel mb-1.5">Garantías</div>
          <div className="flex flex-col gap-1">
            {lot.warranty.map((w, i) => (
              <div key={`${w.guide}-${w.catalogItemId}-${i}`} className="flex items-center gap-2 bg-cloud rounded-md px-2.5 py-1.5 text-[11.5px]">
                <span className="font-mono text-[9px] font-bold uppercase rounded-full px-1.5 py-0.5 bg-red/10 text-red border border-red/30 shrink-0">Garantía</span>
                <CatalogCode code={w.justCode} />
                <span className="flex-1 min-w-0">
                  {w.name}
                  <span className="text-steel">
                    {" "}
                    — {warrantyText(w)} · guía {w.guide} · {carrierLabel(w.carrier)}
                  </span>
                </span>
                <span className="font-mono font-bold text-teal shrink-0">{w.quantity}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {provisional.length > 0 && <ProvisionalBox lines={provisional} />}
      {(lot.discontinued?.length ?? 0) > 0 && <DiscontinuedBox lines={lot.discontinued!} />}

      {err && <div className="text-red text-[12px] mb-2">{err}</div>}

      {lot.status === "DRAFT" && !canSubmit && (
        <div className="text-[12px] bg-gold/15 border border-gold/40 rounded-md p-2.5 mb-3">
          Daniel todavía está armando este corte. El escáner aparece cuando lo envíe. Los cortes anteriores están en &quot;Cortes por día&quot;, abajo.
        </div>
      )}

      {lot.backfill && lot.status !== "DRAFT" && <BackfillConfirmBox lot={lot} onChanged={onChanged} />}
      {lot.status !== "DRAFT" && !lot.backfill && <GuideHoldsBox lot={lot} />}
      {lot.viewer?.canConfirm && lot.status !== "CLOSED" && !lot.backfill && <RereadVariantsButton lotId={lot.id} onChanged={onChanged} />}
      {lot.status !== "DRAFT" && !lot.backfill && <PickingPanel lot={lot} onChanged={onChanged} />}

      {editable && !confirming && (
        <button
          type="button"
          disabled={isEmpty}
          className="rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-50"
          onClick={() => setConfirming(true)}
        >
          Enviar a Inventario
        </button>
      )}

      {editable && !confirming && isEmpty && (
        <button type="button" className="ml-2 rounded border border-red/50 px-3.5 py-2 text-[12.5px] font-bold text-red cursor-pointer" onClick={removeLot}>
          Eliminar corte vacío
        </button>
      )}

      {editable && confirming && (
        // Doble confirmación pedida por el usuario: Yair ve el resumen antes
        // de enviar, porque después ya no puede cambiar el corte.
        <div className="bg-cloud border border-teal/40 rounded-md p-3">
          <div className="font-bold text-[13px] mb-1">
            ¿Enviar el Corte {lot.corte} ({fmtDay(lot.day)}) a Inventario?
          </div>
          <div className="text-[12px] mb-1">
            {lot.batches.length} {lot.batches.length === 1 ? "subida" : "subidas"} · {totalGuides} guías · {lot.lines.length} productos · {units} unidades
            {lot.warranty.length > 0 ? ` · ${lot.warranty.length} garantía(s)` : ""}
          </div>
          {perCarrier.length > 0 && (
            <div className="text-[11.5px] text-steel mb-1">
              {perCarrier.map((p) => `${carrierLabel(p.c)}: ${p.g} ${p.g === 1 ? "guía" : "guías"} (${p.q} unid.)`).join(" · ")}
            </div>
          )}
          {lot.shortages.length > 0 && (
            <div className="text-[11.5px] text-red mb-1">{lot.shortages.length} producto(s) no alcanzan en stock — se avisará a Bryan Ríos y Jariel.</div>
          )}
          <div className="text-[11.5px] font-semibold mb-2.5">Una vez enviado ya no podrás cambiarlo.</div>
          <div className="flex gap-2 flex-wrap">
            <button type="button" disabled={sending} className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={send}>
              {sending ? "Enviando…" : "Sí, enviar a Inventario"}
            </button>
            <button type="button" disabled={sending} className="rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer" onClick={() => setConfirming(false)}>
              Revisar otra vez
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Pedido del usuario 2026-09-30: un cliente compró en Dropi un producto que
// no tenemos (dado de baja). Esas guías NO salen — Heidy lo da de baja en Dropi.
function DiscontinuedBox({ lines }: { lines: NonNullable<CompiledLot["discontinued"]> }) {
  return (
    <div className="text-[11.5px] bg-red/5 border border-red/40 rounded-md p-2.5 mb-3">
      <div className="font-semibold text-red mb-0.5">Guías que NO salen: producto dado de baja ({lines.length})</div>
      <div className="text-[10.5px] text-steel mb-1.5">No lo tenemos en bodega. No hay que sacar nada; <B2BAdvisorName /> lo da de baja en Dropi y Bryan gestiona con Dropi que anulen la guía.</div>
      {lines.map((l, i) => (
        <div key={`${l.code}-${i}`} className="flex items-start gap-2 py-1 border-t border-red/20">
          <span className="font-mono text-[10.5px] font-bold shrink-0">{l.code}</span>
          <div className="flex-1 min-w-0">
            <div>{l.name}</div>
            <div className="text-[10.5px] text-steel">
              {l.guideNumbers.length > 0 ? `Guía ${l.guideNumbers.join(", ")}` : "Guía no leída"}
              {l.carriers.length > 0 ? ` · ${l.carriers.map((c) => { const i = c.lastIndexOf(" "); return i > 0 ? `${carrierLabel(c.slice(0, i))} ${c.slice(i + 1)}` : c; }).join(" · ")}` : ""}
            </div>
          </div>
          <span className="font-mono font-bold text-red shrink-0">{l.quantity}</span>
        </div>
      ))}
    </div>
  );
}

// Pedido del usuario 2026-09-28 (PROVISIONAL): productos de ALF con ID
// provisional — están en bodega pero no en INVESTOCK. Siempre a la vista
// (el equipo los saca a mano): no se escanean ni se descuentan del stock.
function ProvisionalBox({ lines }: { lines: ProvisionalLotLine[] }) {
  return (
    <div className="text-[11.5px] bg-gold/10 border border-gold/40 rounded-md p-2.5 mb-3">
      <div className="font-semibold mb-0.5" style={{ color: "var(--color-gold)" }}>
        Productos ALF ({lines.length}) — leídos de las guías, no están en INVESTOCK
      </div>
      <div className="text-[10.5px] text-steel mb-1.5">Sácalos mirando esta lista: no se escanean ni se descuentan del stock.</div>
      {lines.map((l) => (
        <div key={l.code || l.name} className="flex items-start gap-2 py-1 border-t border-gold/20">
          <span className="font-mono text-[10.5px] font-bold shrink-0">{l.code}</span>
          <div className="flex-1 min-w-0">
            <div>{l.name}</div>
            <div className="text-[10.5px] text-steel">
              {sortCarriers(Object.keys(l.byCarrier))
                .map((c) => `${carrierLabel(c)} ${l.byCarrier[c]}`)
                .join(" · ")}
              {l.variants.length > 0 ? ` · ${l.variants.join(" · ")}` : ""}
            </div>
          </div>
          <span className="font-mono font-bold text-teal shrink-0">{l.quantity}</span>
        </div>
      ))}
    </div>
  );
}

// Pedido de Daniel (2026-09-28): cuántas guías trae el manifiesto de cada
// marca y transportadora, siempre a la vista (sin abrir el detalle) para que
// el equipo lo vea al escanear sin preguntarle a Yair. Rocket va como su
// propio grupo. Cortes viejos (sin productos por guía): por plataforma.
function GuideCounts({ lot }: { lot: CompiledLot }) {
  const byBrand = lot.guidesByBrand;
  const sources = Object.keys(lot.guidesBySource ?? {}).sort();
  const rows: { label: string | null; counts: Record<string, number> }[] = byBrand
    ? sortBrands(Object.keys(byBrand)).map((k) => ({ label: brandLabel(k), counts: byBrand[k] }))
    : sources.length > 1
      ? sources.map((s) => ({ label: sourceLabel(s), counts: lot.guidesBySource[s] }))
      : [{ label: null, counts: lot.guidesByCarrier }];
  if (rows.length > 1) rows.push({ label: "Total", counts: lot.guidesByCarrier });
  return (
    <div className="bg-cloud border border-rule rounded-md px-2.5 py-2 mb-3">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-steel mb-1">{byBrand ? "Guías por marca y transportadora" : "Guías por transportadora"}</div>
      {rows.map((r) => {
        const carriers = sortCarriers(Object.keys(r.counts).filter((c) => r.counts[c] > 0));
        const total = carriers.reduce((s, c) => s + r.counts[c], 0);
        return (
          <div key={r.label ?? "all"} className="flex flex-wrap items-center gap-1.5 mb-1 last:mb-0">
            {r.label && <span className="text-[11px] font-bold w-24 shrink-0">{r.label}</span>}
            {carriers.map((c) => (
              <span key={c} className="text-[12px] rounded-full border border-teal/35 bg-teal/10 px-2.5 py-0.5">
                {carrierLabel(c)} <b className="font-mono text-teal">{r.counts[c]}</b>
              </span>
            ))}
            <span className="text-[12px] font-semibold px-1">
              Total <b className="font-mono text-teal">{total}</b>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function LotHistoryList({ lots, onView, defaultOpen = false }: { lots: LotListItem[]; onView: (id: string) => void; defaultOpen?: boolean }) {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const show = toggled ?? defaultOpen;
  if (lots.length === 0) return null;
  const days: { day: string; lots: LotListItem[] }[] = [];
  for (const l of lots) {
    const last = days[days.length - 1];
    if (last && last.day === l.day) last.lots.push(l);
    else days.push({ day: l.day, lots: [l] });
  }
  return (
    <div>
      <button type="button" className="flex items-center gap-1 text-[11px] font-semibold text-steel hover:text-teal cursor-pointer" onClick={() => setToggled(!show)}>
        {show ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Historial de cortes cerrados ({lots.length})
      </button>
      {show && (
        <div className="mt-2 flex flex-col gap-2">
          {days.map((d) => (
            <div key={d.day}>
              <div className="text-[11px] font-semibold capitalize mb-0.5">{fmtDay(d.day)}</div>
              <div className="flex flex-wrap gap-1.5">
                {[...d.lots].reverse().map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className="text-[10.5px] rounded-full border border-rule px-2 py-0.5 text-steel hover:text-teal hover:border-teal cursor-pointer"
                    onClick={() => onView(l.id)}
                  >
                    Corte {l.corte} · {STATUS_LABEL[l.status]} · {l.guides} guías
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Manifiesto atrasado (pedido del usuario 2026-09-29): la mercadería ya
// salió, así que no se escanea. Daniel confirma de una vez (doble
// confirmación) y se descuenta del stock todo lo pedido, menos lo que ya
// entró en un conteo físico hecho después de ese día.
function BackfillConfirmBox({ lot, onChanged }: { lot: CompiledLot; onChanged: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const counted = lot.countedAfter ?? [];
  const units = lot.picking.reduce((s, p) => s + p.needed, 0);
  const countedUnits = lot.picking.filter((p) => counted.some((c) => c.catalogItemId === p.catalogItemId)).reduce((s, p) => s + p.needed, 0);
  const canConfirm = !!lot.viewer?.canConfirm;

  async function confirm() {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/fulfillment-lots/${lot.id}/confirm-backfill`, { method: "POST" });
    const json = await res.json().catch(() => null);
    setBusy(false);
    setAsking(false);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo confirmar.");
      return;
    }
    onChanged();
  }

  const countedList = counted.length > 0 && (
    <div className="mt-2">
      <div className="font-semibold mb-0.5">
        {lot.status === "CLOSED" ? "No se descontaron" : "No se van a descontar"} ({counted.length}) — ya estaban en un conteo físico hecho después de ese día:
      </div>
      {counted.map((c) => (
        <div key={c.catalogItemId} className="flex items-center gap-1.5 pl-2">
          <CatalogCode code={c.justCode} />
          <span className="flex-1 min-w-0">{c.name}</span>
          <span className="font-mono text-[10.5px] text-steel">conteo {fmtDateShort(c.countedAt)}</span>
        </div>
      ))}
    </div>
  );

  if (lot.status === "CLOSED") {
    return (
      <div className="text-[12px] bg-teal/10 border border-teal/30 rounded-md p-2.5 mb-3">
        <div className="font-semibold text-teal">Manifiesto atrasado confirmado — se descontó del stock{lot.closedAt ? ` el ${fmtDateShort(lot.closedAt)}` : ""}.</div>
        {countedList}
      </div>
    );
  }

  return (
    <div className="text-[12px] bg-gold/10 border border-gold/40 rounded-md p-3 mb-3">
      <div className="font-semibold mb-1">Esta mercadería ya salió el {fmtDay(lot.day)} — no hay que sacar ni escanear nada.</div>
      <div className="text-steel mb-1">
        Al confirmar se descuentan del stock las {units - countedUnits} unidades de este manifiesto, igual que un corte normal (queda como Egreso de despacho).
      </div>
      {countedList}
      {err && <div className="text-red mt-2">{err}</div>}
      {!canConfirm ? (
        <div className="text-steel mt-2">Daniel lo confirma desde aquí.</div>
      ) : !asking ? (
        <button type="button" className="mt-2 rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer" onClick={() => setAsking(true)}>
          Ya salió todo — descontar del stock
        </button>
      ) : (
        <div className="mt-2 flex items-center gap-2.5 flex-wrap">
          <span className="font-semibold">¿Estás seguro? Se descuentan {units - countedUnits} unidades y no se puede deshacer.</span>
          <button type="button" disabled={busy} className="rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={confirm}>
            {busy ? "Descontando…" : "Sí, confirmar"}
          </button>
          <button type="button" disabled={busy} className="text-steel text-[12.5px] cursor-pointer" onClick={() => setAsking(false)}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

// Pedido del usuario 2026-10-03: cuando se mejora el lector de guías, Daniel
// relee los PDF guardados del corte para recuperar variantes que antes salían
// "Sin variante". Solo cambia esas notas, nunca cantidades.
function RereadVariantsButton({ lotId, onChanged }: { lotId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; lines?: string[] } | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/fulfillment-lots/${lotId}/reread-variants`, { method: "POST" });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: json?.error ?? "No se pudo volver a leer." });
      return;
    }
    const updated: { name: string; carrier: string | null; labels: string[] }[] = json.updated ?? [];
    if (updated.length === 0) {
      setMsg({ ok: true, text: "Listo: no había variantes nuevas por recuperar." });
      return;
    }
    setMsg({ ok: true, text: `Listo: se recuperaron variantes en ${updated.length} producto(s).`, lines: updated.map((u) => `${u.name}${u.carrier ? ` (${u.carrier})` : ""}: ${u.labels.join(" · ")}`) });
    onChanged();
  }

  return (
    <div className="text-[12px] mb-3">
      <button type="button" disabled={busy} onClick={run} className="rounded border border-teal/60 px-3 py-1.5 text-[12px] font-semibold text-teal cursor-pointer disabled:opacity-60">
        {busy ? "Leyendo los PDF del corte…" : "Volver a leer variantes de las guías"}
      </button>
      {msg && (
        <div className={`mt-1.5 ${msg.ok ? "text-teal" : "text-red"}`}>
          {msg.text}
          {msg.lines?.map((l) => (
            <div key={l} className="text-steel pl-2">
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
