"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Search } from "lucide-react";
import { TabGuide } from "@/components/shared/TabGuide";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { formatDateTime } from "@/lib/formatDateTime";
import { actorName } from "@/lib/actorName";

type Mark = { at: string; by: string | null };
type StepKey = "dropiImages" | "dropiInfo" | "driveVideo" | "realPhotos" | "channel";
type Board = { pending: Entry[]; realPhotos: Entry[]; done: Entry[]; canAct: boolean };
type View = "pending" | "realPhotos" | "done";

type Entry = {
  key: string;
  catalogItemId: string | null;
  proposalId: string | null;
  name: string;
  code: string | null;
  referencePhotos: string[];
  arrivalPhotos: string[];
  arrivedAt: string | null;
  arrivals: number;
  dropiPublishedAt: string | null;
  since: string;
  steps: Record<"dropiImages" | "dropiInfo" | "driveVideo", Mark | null>;
  branded: { at: string | null; by: string | null; legacy: boolean } | null;
  realPhotos: Mark | null;
  channel: Mark | null;
};

// El brandeo se hace fuera de DAFLOW; acá solo se marca cada paso.
const BRAND_STEPS: { key: "dropiImages" | "dropiInfo" | "driveVideo"; label: string }[] = [
  { key: "dropiImages", label: "Imágenes brandeadas subidas a Dropi" },
  { key: "dropiInfo", label: "Información (descripción) subida a Dropi" },
  { key: "driveVideo", label: "Videos subidos al Drive" },
];

function Thumbs({ label, urls }: { label: string; urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="flex-1 min-w-[180px] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1.5">{label}</div>
      <div className="flex gap-2 flex-wrap">
        {urls.map((u, i) => (
          <div key={i} className="bg-cloud rounded border border-rule flex items-center justify-center w-24 h-24 shrink-0">
            <img src={u} alt="" className="max-w-full max-h-full object-contain" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Origin({ e }: { e: Entry }) {
  const parts: string[] = [];
  if (e.arrivedAt) parts.push(`Llegó a bodega ${formatDateTime(e.arrivedAt)}${e.arrivals > 1 ? ` · ${e.arrivals} llegadas` : ""}`);
  if (e.dropiPublishedAt) parts.push(`ID de Dropi confirmado ${formatDateTime(e.dropiPublishedAt)}`);
  if (!e.arrivedAt && e.dropiPublishedAt) parts.push("todavía no llega a bodega");
  return <div className="text-[12px] text-steel mb-3">{parts.join(" · ")}</div>;
}

// Confirmado 2026-08-08 (mismo espíritu): marcar pide "¿seguro?" antes, para
// que nadie marque por marcar. Desmarcar no pregunta (es corregir un error).
function StepCheck({ label, mark, canToggle, onToggle }: { label: string; mark: Mark | null; canToggle: boolean; onToggle: (done: boolean) => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(done: boolean) {
    setBusy(true);
    await onToggle(done);
    setBusy(false);
    setAsking(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px] min-h-[28px]">
      <label className={`flex items-center gap-2 ${canToggle ? "cursor-pointer" : ""}`}>
        <input
          type="checkbox"
          checked={!!mark}
          disabled={!canToggle || busy}
          onChange={() => (mark ? run(false) : setAsking(true))}
          className="w-4 h-4 accent-teal"
        />
        <span className={mark ? "text-teal" : "text-ink"}>{label}</span>
      </label>
      {mark && (
        <span className="text-[11.5px] text-steel">
          — {actorName(mark.by)} · {formatDateTime(mark.at)}
        </span>
      )}
      {asking && !mark && (
        <span className="flex items-center gap-2 bg-gold/10 border border-gold/35 rounded px-2 py-1">
          <span className="text-[11.5px]" style={{ color: "#D9A441" }}>¿Seguro que ya lo hiciste?</span>
          <button type="button" disabled={busy} className="text-[11.5px] font-bold text-teal cursor-pointer disabled:opacity-60" onClick={() => run(true)}>Sí</button>
          <button type="button" className="text-[11.5px] text-steel cursor-pointer" onClick={() => setAsking(false)}>No</button>
        </span>
      )}
    </div>
  );
}

// Confirmado 2026-09-23, pedido de Robert: los IDs nuevos por brandear tienen
// su propia pestaña, separada de Mercadería recibida. Cada producto aparece
// una sola vez. El brandeo se hace en Dropi y Google Drive; acá Robert marca
// cada paso para que todo el flujo sepa en qué va. Con los 3 pasos pasa al
// historial, donde queda la casilla "subido al canal de la marca".
// Confirmado 2026-09-25, pedido de Robert: entre el brandeo y el historial va
// "Imágenes reales" — el producto espera ahí hasta que llega a bodega y se le
// toman fotos reales; recién ahí pasa al historial, listo para el canal.
export function NewIdBrandingPanel() {
  const [data, setData] = useState<Board | null>(null);
  const [view, setView] = useState<View>("pending");
  const [search, setSearch] = useState("");
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/new-id-branding")
      .then((r) => (r.ok ? r.json() : { pending: [], realPhotos: [], done: [], canAct: false }))
      .then(setData)
      .catch(() => setData({ pending: [], realPhotos: [], done: [], canAct: false }));
  }
  useEffect(load, []);

  async function toggle(e: Entry, step: StepKey, done: boolean) {
    setErr("");
    const res = await fetch("/api/new-id-branding/step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogItemId: e.catalogItemId, proposalId: e.proposalId, step, done }),
    }).catch(() => null);
    if (!res?.ok) {
      const d = await res?.json().catch(() => null);
      setErr(d?.error ?? "No se pudo guardar, intenta de nuevo.");
    }
    load();
  }

  if (!data) return <div className="text-steel text-[13px]">Cargando…</div>;

  const query = search.trim().toLowerCase();
  const list = data[view].filter(
    (e) => !query || e.name.toLowerCase().includes(query) || e.code?.toLowerCase().includes(query)
  );
  const notOnChannel = data.done.filter((e) => !e.channel).length;
  const arrivedForPhotos = data.realPhotos.filter((e) => e.arrivedAt).length;

  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1 text-[11.5px] font-semibold cursor-pointer transition-colors ${active ? "border-blue bg-blue text-white" : "border-rule text-steel hover:border-blue/50"}`;

  return (
    <div className="flex flex-col gap-3">
      <TabGuide storageKey="nuevos-ids-brandear">
        {data.canAct ? (
          <>Acá aparece cada producto nuevo <b>una sola vez</b>: cuando llega a bodega por primera vez o cuando Heidy confirma su ID de Dropi. El brandeo lo haces como siempre en Dropi y en el Drive — acá solo marca cada paso cuando ya lo hiciste. Con los 3 pasos marcados pasa a <b>Imágenes reales</b>: ahí espera hasta que el producto llegue a bodega y le tomes las fotos reales. Cuando marcas las imágenes reales pasa al <b>Historial</b>, donde marcas cuando ya lo subiste al canal de la marca.</>
        ) : (
          <>Vista de solo lectura: qué productos nuevos faltan por brandear, cuáles esperan sus imágenes reales, y el historial de los que ya están listos para el canal.</>
        )}
      </TabGuide>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={pill(view === "pending")} onClick={() => setView("pending")}>
          Por brandear ({data.pending.length})
        </button>
        <button type="button" className={pill(view === "realPhotos")} onClick={() => setView("realPhotos")}>
          Imágenes reales ({data.realPhotos.length}){arrivedForPhotos > 0 ? ` · ${arrivedForPhotos} ya en bodega` : ""}
        </button>
        <button type="button" className={pill(view === "done")} onClick={() => setView("done")}>
          Historial ({data.done.length}){notOnChannel > 0 ? ` · ${notOnChannel} sin subir al canal` : ""}
        </button>
        <div className="relative ml-auto" style={{ width: 280, maxWidth: "100%" }}>
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-steel" />
          <input
            type="text"
            value={search}
            onChange={(ev) => setSearch(ev.target.value)}
            placeholder="Buscar por nombre o ID..."
            className="w-full rounded border border-rule bg-surface pl-8 pr-2.5 py-1.5 text-[12.5px]"
          />
        </div>
      </div>

      {err && <div className="text-red text-[12.5px]">{err}</div>}

      {list.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13.5px]">
          {query ? <>No se encontró ningún producto con &quot;{search.trim()}&quot;.</> : view === "pending" ? "No hay IDs nuevos por brandear." : view === "realPhotos" ? "No hay productos esperando imágenes reales." : "Todavía no hay productos listos para el canal."}
        </div>
      )}

      {list.map((e) => {
        const doneSteps = BRAND_STEPS.filter((s) => e.steps[s.key]).length;
        return (
          <div key={e.key} className="bg-surface border border-rule rounded-md p-4">
            <div className="text-[14.5px] font-bold mb-0.5 flex items-center gap-1.5 flex-wrap">
              <CatalogCode code={e.code} size="text-[11px]" />
              <span>{e.name}</span>
              {!e.code && <span className="text-[10.5px] font-semibold text-gold border border-gold/40 rounded px-1.5 py-0.5">Sin ID todavía</span>}
            </div>
            <Origin e={e} />

            {view === "pending" ? (
              <>
                <div className="flex flex-wrap divide-x divide-rule border border-rule rounded-md overflow-hidden mb-3.5">
                  <Thumbs label="Referencia — como se registró el producto" urls={e.referencePhotos} />
                  <Thumbs label="Llegó así — foto real de la recepción" urls={e.arrivalPhotos} />
                </div>
                <div className="pt-3 border-t border-rule">
                  <div className="text-[11px] font-semibold text-ink mb-1.5">
                    Brandeo <span className="font-normal text-steel">· {doneSteps} de {BRAND_STEPS.length} pasos</span>
                  </div>
                  {BRAND_STEPS.map((s) => (
                    <StepCheck key={s.key} label={s.label} mark={e.steps[s.key]} canToggle={data.canAct} onToggle={(done) => toggle(e, s.key, done)} />
                  ))}
                </div>
              </>
            ) : view === "realPhotos" ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-[12px] text-teal">
                  <CheckCircle2 size={14} /> Brandeado — {actorName(e.branded?.by ?? null)}{e.branded?.at ? ` · ${formatDateTime(e.branded.at)}` : ""}
                </div>
                <div className="pt-2.5 border-t border-rule">
                  {e.arrivedAt ? (
                    <StepCheck label="Imágenes reales tomadas" mark={e.realPhotos} canToggle={data.canAct} onToggle={(done) => toggle(e, "realPhotos", done)} />
                  ) : (
                    <div className="flex items-center gap-2 text-[12.5px] text-steel">
                      <Clock size={14} /> Esperando que llegue a bodega para tomar las imágenes reales.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-[12px] text-teal">
                  <CheckCircle2 size={14} /> Brandeado — {actorName(e.branded?.by ?? null)}{e.branded?.at ? ` · ${formatDateTime(e.branded.at)}` : ""}
                </div>
                {e.branded?.legacy ? (
                  <div className="text-[11.5px] text-steel">Se confirmó antes de que existiera esta sección, por eso no tiene los pasos por separado.</div>
                ) : (
                  <div>
                    {BRAND_STEPS.map((s) => (
                      <StepCheck key={s.key} label={s.label} mark={e.steps[s.key]} canToggle={false} onToggle={async () => {}} />
                    ))}
                  </div>
                )}
                {e.realPhotos && (
                  <StepCheck label="Imágenes reales tomadas" mark={e.realPhotos} canToggle={data.canAct && !e.channel} onToggle={(done) => toggle(e, "realPhotos", done)} />
                )}
                <div className="pt-2.5 border-t border-rule">
                  <StepCheck label="Subido al canal de la marca" mark={e.channel} canToggle={data.canAct} onToggle={(done) => toggle(e, "channel", done)} />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
