"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Package, Printer, X } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { carrierLabel } from "@/lib/carriers";
import { sourceLabel, type VariantNote } from "./fulfillmentRequestShared";
import { PickingPanel } from "./PickingPanel";
import { LotComboRecipe, type LotComboRecipe as ComboRecipe } from "./LotComboRecipe";

type ItemView = { catalogItemId: string; name: string; photos: string[]; justCode: string | null };
export type LotLine = ItemView & { quantity: number; byCarrier: Record<string, number>; fromCombos: { code: string; quantity: number }[]; variants: VariantNote[] };
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
};
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
  batches: LotBatch[];
  lines: LotLine[];
  warranty: LotWarrantyLine[];
  combos: ComboRecipe[];
  shortages: LotShortage[];
  manifestNumber: number | null;
  printedAt: string | null;
  printedByName: string | null;
  closedAt: string | null;
  picking: LotPickLine[];
  viewer?: { canPrint: boolean; canPick: boolean; canConfirm: boolean };
};
export type LotListItem = { id: string; day: string; corte: number; status: LotStatus; createdAt: string; sentAt: string | null; uploads: number; guides: number };

export function fmtDay(day: string) {
  // Mediodía UTC: evita que la zona horaria del navegador corra la fecha un día.
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit", timeZone: "America/Guayaquil" });
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
  const shownCombo = lot.combos.find((c) => c.code === openCombo) ?? null;
  const units = lot.lines.reduce((s, l) => s + l.quantity, 0);
  const perCarrier = lot.carriers.map((c) => ({ c, q: lot.lines.reduce((s, l) => s + (l.byCarrier[c] ?? 0), 0) }));
  const editable = lot.status === "DRAFT" && canSubmit;

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
    if (!lot.manifestNumber) onChanged();
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
        <span className={`font-mono text-[9.5px] font-bold uppercase rounded-full px-2 py-0.5 border ${STATUS_STYLE[lot.status]}`}>{STATUS_LABEL[lot.status]}</span>
        {lot.manifestNumber && <span className="font-mono text-[11px] font-bold">{manifestCode(lot.manifestNumber)}</span>}
        {lot.status !== "DRAFT" && lot.viewer?.canPrint && (
          <button type="button" className="ml-auto flex items-center gap-1.5 rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer" onClick={print}>
            <Printer size={13} /> {lot.manifestNumber ? "Reimprimir manifiesto" : "Imprimir manifiesto"}
          </button>
        )}
      </div>
      <div className="text-[11.5px] text-steel mb-2">
        {lot.lines.length} productos · {units} unidades
        {lot.warranty.length > 0 ? ` · ${lot.warranty.length} garantía(s)` : ""}
        {lot.sentAt ? ` · enviado ${fmtTime(lot.sentAt)}${lot.sentByName ? ` por ${lot.sentByName}` : ""}` : ""}
        {lot.printedAt ? ` · impreso ${fmtTime(lot.printedAt)}${lot.printedByName ? ` por ${lot.printedByName}` : ""}` : ""}
      </div>

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
                <div key={p.label} className="text-[11px] pl-2" style={{ color: "#D9A441" }}>
                  ↳ {p.qty} en {p.label} — ingrésalas para que cuenten en el stock
                </div>
              ))}
            </div>
          ))}
          <div className="text-[10.5px] text-steel mt-1">
            {lot.status === "DRAFT"
              ? "Al enviar el corte, Daniel recibe este aviso; a Bryan Ríos y Jariel solo les llega lo que falta aun contando las devoluciones sin ingresar."
              : "Daniel ya recibió este aviso; a Bryan Ríos y Jariel les llegó solo lo que falta de verdad."}
          </div>
        </div>
      )}

      {lot.lines.length > 0 && (
        <div className="overflow-x-auto mb-3">
          <table className="w-full text-[11.5px] border-collapse">
            <thead>
              <tr className="text-left text-steel border-b border-rule">
                <th className="py-1 pr-2 font-semibold">ID</th>
                <th className="py-1 pr-2 font-semibold">Producto</th>
                {lot.carriers.map((c) => (
                  <th key={c} className="py-1 px-1.5 font-semibold text-right whitespace-nowrap">
                    {carrierLabel(c)}
                  </th>
                ))}
                <th className="py-1 pl-1.5 font-semibold text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {lot.lines.map((l) => (
                <tr key={l.catalogItemId} className="border-b border-rule/60 align-top">
                  <td className="py-1.5 pr-2 font-mono whitespace-nowrap">{l.justCode ?? "—"}</td>
                  <td className="py-1.5 pr-2">
                    <div className="flex items-start gap-2">
                      <Thumb url={l.photos[0]} />
                      <div className="min-w-0">
                        <div>{l.name}</div>
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
              ))}
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

      {err && <div className="text-red text-[12px] mb-2">{err}</div>}

      {lot.status === "DRAFT" && !canSubmit && (
        <div className="text-[12px] bg-gold/15 border border-gold/40 rounded-md p-2.5 mb-3">
          Yair todavía está armando este corte. El escáner aparece cuando lo envíe a Inventario. Los cortes anteriores están en &quot;Cortes por día&quot;, abajo.
        </div>
      )}

      {lot.status !== "DRAFT" && <PickingPanel lot={lot} onChanged={onChanged} />}

      {editable && !confirming && (
        <button
          type="button"
          disabled={lot.lines.length === 0 && lot.warranty.length === 0}
          className="rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-50"
          onClick={() => setConfirming(true)}
        >
          Enviar a Inventario
        </button>
      )}

      {editable && !confirming && lot.lines.length === 0 && lot.warranty.length === 0 && (
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
            {lot.batches.length} {lot.batches.length === 1 ? "subida" : "subidas"} · {lot.lines.length} productos · {units} unidades
            {lot.warranty.length > 0 ? ` · ${lot.warranty.length} garantía(s)` : ""}
          </div>
          {perCarrier.length > 0 && <div className="text-[11.5px] text-steel mb-1">{perCarrier.map((p) => `${carrierLabel(p.c)} ${p.q}`).join(" · ")}</div>}
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

export function LotHistoryList({ lots, onView }: { lots: LotListItem[]; onView: (id: string) => void }) {
  const [show, setShow] = useState(false);
  if (lots.length === 0) return null;
  const days: { day: string; lots: LotListItem[] }[] = [];
  for (const l of lots) {
    const last = days[days.length - 1];
    if (last && last.day === l.day) last.lots.push(l);
    else days.push({ day: l.day, lots: [l] });
  }
  return (
    <div>
      <button type="button" className="flex items-center gap-1 text-[11px] font-semibold text-steel hover:text-teal cursor-pointer" onClick={() => setShow((s) => !s)}>
        {show ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Cortes por día ({days.length})
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
