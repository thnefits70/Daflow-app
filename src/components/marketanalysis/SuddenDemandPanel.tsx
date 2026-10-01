"use client";

import { useEffect, useState } from "react";
import { B2BAdvisorName } from "@/components/shared/B2BAdvisorName";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { formatDateTime } from "@/lib/formatDateTime";

type Card = {
  id: string;
  catalogItemId: string;
  name: string;
  justCode: string | null;
  photo: string | null;
  day: string;
  active: boolean;
  baselineUnits: number;
  dayUnits: number;
  since: { day: string; units: number }[];
  sinceTotal: number;
  stock: number;
  daysLeft: number | null;
  openPurchase: { code: string | null; quantity: number } | null;
  returns: { good: number; damaged: number };
  note: string | null;
  noteByName: string | null;
  noteAt: string | null;
};
type Data = { today: string; cards: Card[]; canWriteNote: boolean; startDay: string };

function fmtDay(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("es-EC", { day: "numeric", month: "short", timeZone: "UTC" });
}

function fmtDaysLeft(d: number | null) {
  if (d === null) return null;
  if (d < 1) return "se acaba hoy";
  const n = Math.floor(d);
  return `alcanza para ${n} día${n === 1 ? "" : "s"}`;
}

function NoteBox({ card, canWrite, onSaved }: { card: Card; canWrite: boolean; onSaved: () => void }) {
  const [text, setText] = useState(card.note ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const r = await fetch(`/api/sudden-demand/${card.id}/note`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: text }),
    }).catch(() => null);
    setSaving(false);
    if (!r || !r.ok) {
      const j = r ? await r.json().catch(() => null) : null;
      setError(j?.error ?? "No se pudo guardar.");
      return;
    }
    setEditing(false);
    onSaved();
  }

  const shown = card.note && !editing;
  return (
    <div className="mt-2.5 rounded-md border border-rule bg-surface2 px-3 py-2">
      <div className="text-[11.5px] font-semibold text-steel mb-1">Nota de Jariel</div>
      {shown && (
        <>
          <div className="text-[13px] text-ink whitespace-pre-wrap">{card.note}</div>
          <div className="text-[11px] text-steel mt-1">
            {card.noteByName} · {card.noteAt ? formatDateTime(card.noteAt) : ""}
            {canWrite && (
              <button type="button" className="ml-2 text-teal font-semibold cursor-pointer" onClick={() => setEditing(true)}>
                Cambiar
              </button>
            )}
          </div>
        </>
      )}
      {!shown && canWrite && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder='Ej. "ya pedí 50", "lo tengo en cuenta", "no compro, fue un pico"'
            className="w-full rounded border border-rule bg-surface px-2 py-1.5 text-[13px] text-ink"
          />
          <div className="flex items-center gap-2 mt-1.5">
            <button
              type="button"
              disabled={saving || (!text.trim() && !card.note)}
              onClick={save}
              className="rounded bg-teal px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50 cursor-pointer"
            >
              {saving ? "Guardando…" : "Guardar nota"}
            </button>
            {editing && (
              <button type="button" className="text-[12px] text-steel cursor-pointer" onClick={() => { setEditing(false); setText(card.note ?? ""); }}>
                Cancelar
              </button>
            )}
            {error && <span className="text-[12px] text-red">{error}</span>}
          </div>
        </>
      )}
      {!shown && !canWrite && <div className="text-[12.5px] text-steel">Jariel todavía no escribió nada.</div>}
    </div>
  );
}

function CardView({ card, canWrite, onSaved }: { card: Card; canWrite: boolean; onSaved: () => void }) {
  const days = fmtDaysLeft(card.daysLeft);
  const later = card.since.filter((s) => s.day !== card.day);
  return (
    <div className="bg-surface border border-rule rounded-md p-3 mb-3">
      <div className="flex items-start gap-3">
        {card.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.photo} alt="" className="w-12 h-12 rounded object-cover bg-cloud shrink-0" />
        ) : (
          <div className="w-12 h-12 rounded bg-cloud shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold text-ink">{card.name}</div>
          {card.justCode && (
            <div className="flex items-center gap-1 text-[12px] text-steel">
              ID <CatalogCode code={card.justCode} size="text-[12px]" />
            </div>
          )}
          <div className="text-[12.5px] text-ink mt-1">
            Antes salía <b>{card.baselineUnits}</b> en todo el mes · el {fmtDay(card.day)} salieron <b className="text-red">{card.dayUnits}</b>
          </div>
          {later.length > 0 && (
            <div className="text-[12px] text-steel">
              Después: {later.map((s) => `${fmtDay(s.day)}: ${s.units}`).join(" · ")} (total desde el salto: {card.sinceTotal})
            </div>
          )}
          <div className="text-[12.5px] text-ink mt-1">
            En bodega (INVESTOCK): <b>{Math.max(0, card.stock)}</b>
            {days ? (
              <>
                {" "}· <b className={card.daysLeft !== null && card.daysLeft <= 7 ? "text-red" : ""}>{days}</b>
              </>
            ) : null}
          </div>
          <div className="text-[12px] text-steel">
            {card.openPurchase
              ? `🛒 Compra en camino: ${card.openPurchase.code ?? "abierta"} de ${card.openPurchase.quantity} u.`
              : "Sin compra en camino"}
            {" · "}
            {card.returns.good + card.returns.damaged > 0
              ? `Devoluciones (30 días): ${card.returns.good} buenas${card.returns.damaged ? `, ${card.returns.damaged} dañadas` : ""}`
              : "Sin devoluciones en 30 días"}
          </div>
        </div>
      </div>
      <NoteBox key={card.note ?? ""} card={card} canWrite={canWrite} onSaved={onSaved} />
    </div>
  );
}

// "Productos que despiertan" (pedido de Daniel 2026-09-29): productos que
// salían 10 o menos al mes y un día salen 4 o más. `compact` = solo los
// activos, sin explicación (Base de datos de productos, para Daniel).
export function SuddenDemandPanel({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch("/api/sudden-demand")
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) setError(j.error ?? "No se pudo cargar.");
        else setData(j);
      })
      .catch(() => setError("No se pudo cargar."));
  }
  useEffect(load, []);

  if (compact) {
    const active = data?.cards.filter((c) => c.active) ?? [];
    if (!data || active.length === 0) return null;
    return (
      <div className="mb-5">
        <div className="text-[14px] font-bold text-ink mb-2">📈 Productos que despiertan ({active.length})</div>
        {active.map((c) => (
          <CardView key={c.id} card={c} canWrite={data.canWriteNote} onSaved={load} />
        ))}
      </div>
    );
  }

  if (error) return <div className="text-red text-[13px]">{error}</div>;
  if (!data) return <div className="text-steel text-[13px]">Cargando…</div>;

  const active = data.cards.filter((c) => c.active);
  const old = data.cards.filter((c) => !c.active);
  const waiting = data.today < data.startDay;

  return (
    <div>
      <div className="bg-teal/10 border border-teal/30 rounded-md px-3 py-2 text-[12px] text-steel mb-4">
        Un producto que salió <b className="text-ink">10 o menos</b> en el último mes y un día sale <b className="text-ink">4 o más</b>. El aviso llega ese mismo día a
        Daniel, Jariel, Bryan Rios y <B2BAdvisorName /> (a Nairoby si hay 31 a 60 en bodega). Si sigue saliendo, no llega otro aviso: la tarjeta se actualiza.
        {data.canWriteNote && <> Escribe en cada tarjeta qué decidiste; todos lo ven.</>}
      </div>
      {waiting && (
        <div className="bg-surface border border-rule rounded-md px-3 py-3 text-[13px] text-steel mb-4">
          Los avisos empiezan solos el <b className="text-ink">{fmtDay(data.startDay)}</b>, cuando la app ya tenga un mes de manifiestos para comparar.
        </div>
      )}
      {!waiting && active.length === 0 && <div className="text-[13px] text-steel mb-4">Ningún producto despertó en los últimos 7 días.</div>}
      {active.map((c) => (
        <CardView key={c.id} card={c} canWrite={data.canWriteNote} onSaved={load} />
      ))}
      {old.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[13px] font-semibold text-steel">Anteriores (últimos 30 días): {old.length}</summary>
          <div className="mt-3">
            {old.map((c) => (
              <CardView key={c.id} card={c} canWrite={data.canWriteNote} onSaved={load} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
