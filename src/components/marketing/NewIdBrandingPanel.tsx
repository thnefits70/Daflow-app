"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, ExternalLink, Film, Link2, Search, Upload, X } from "lucide-react";
import { TabGuide } from "@/components/shared/TabGuide";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { formatDateTime } from "@/lib/formatDateTime";
import { actorName } from "@/lib/actorName";
import { compressImage } from "@/lib/compressImage";
import { uploadFile } from "@/lib/uploadFile";

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
  branded: { at: string | null; by: string | null; photos: string[]; videoUrls: string[]; legacy: boolean } | null;
  channel: { at: string; by: string | null } | null;
};

const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const FOLDER = "new-id-branding";

function isVideoFileUrl(url: string) {
  return /\.(mp4|mov|webm|avi|m4v)($|\?)/i.test(url);
}

function Thumbs({ label, urls }: { label: string; urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="flex-1 min-w-[180px] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1.5">{label}</div>
      <div className="flex gap-2 flex-wrap">
        {urls.map((u, i) => (
          <div key={i} className="bg-cloud rounded border border-rule flex items-center justify-center w-28 h-28 shrink-0">
            <img src={u} alt="" className="max-w-full max-h-full object-contain" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Videos({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="flex gap-2 flex-wrap">
      {urls.map((u, i) =>
        isVideoFileUrl(u) ? (
          <video key={i} src={u} controls className="w-56 h-32 rounded object-contain border border-rule bg-navy" />
        ) : (
          <a key={i} href={u} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded border border-rule px-2.5 py-1.5 text-[12px] text-teal hover:border-teal">
            <ExternalLink size={13} /> Abrir video en Drive
          </a>
        )
      )}
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

function BrandForm({ e, onDone }: { e: Entry; onDone: () => void }) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [videos, setVideos] = useState<string[]>([]);
  const [driveLink, setDriveLink] = useState("");
  const [uploading, setUploading] = useState<"photo" | "video" | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const photoRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLInputElement | null>(null);

  async function addPhotos(files: FileList) {
    setErr("");
    setUploading("photo");
    for (const file of Array.from(files)) {
      const up = await uploadFile(await compressImage(file), FOLDER);
      if (!up.ok) { setErr(up.error); break; }
      setPhotos((s) => [...s, up.url].slice(0, 10));
    }
    setUploading(null);
  }

  async function addVideo(file: File) {
    setErr("");
    if (file.size > MAX_VIDEO_BYTES) {
      setErr("El video pesa más de 50MB. Súbelo a Drive y pega el enlace abajo.");
      return;
    }
    setUploading("video");
    const up = await uploadFile(file, FOLDER);
    setUploading(null);
    if (!up.ok) { setErr(up.error); return; }
    setVideos((s) => [...s, up.url].slice(0, 5));
  }

  const link = driveLink.trim();
  const linkValid = link === "" || /^https?:\/\/\S+$/i.test(link);
  const allVideos = [...videos, ...(link && linkValid ? [link] : [])];
  const ready = photos.length > 0 && allVideos.length > 0 && linkValid && !uploading;

  async function finish() {
    setBusy(true);
    setErr("");
    const res = await fetch("/api/new-id-branding/brand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogItemId: e.catalogItemId, proposalId: e.proposalId, photos, videoUrls: allVideos }),
    }).catch(() => null);
    setBusy(false);
    setAsking(false);
    if (!res?.ok) {
      const d = await res?.json().catch(() => null);
      setErr(d?.error ?? "No se pudo guardar, intenta de nuevo.");
      return;
    }
    onDone();
  }

  return (
    <div className="pt-3 border-t border-rule flex flex-col gap-2.5">
      <div>
        <div className="text-[11px] font-semibold text-ink mb-1">Fotos reales brandeadas</div>
        <div className="flex gap-2 flex-wrap">
          {photos.map((u, i) => (
            <div key={i} className="relative w-16 h-16">
              <img src={u} alt="" className="w-16 h-16 rounded object-cover border border-rule" />
              <button type="button" className="absolute -top-1.5 -right-1.5 bg-navy rounded-full text-steel hover:text-white cursor-pointer" onClick={() => setPhotos((s) => s.filter((_, j) => j !== i))}>
                <X size={13} />
              </button>
            </div>
          ))}
          {photos.length < 10 && (
            <button type="button" className="w-16 h-16 rounded border-[1.5px] border-dashed border-rule flex items-center justify-center text-steel cursor-pointer hover:border-teal" onClick={() => photoRef.current?.click()}>
              {uploading === "photo" ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Camera size={16} />}
            </button>
          )}
        </div>
        <input ref={photoRef} type="file" accept="image/*" multiple className="hidden" onChange={(ev) => { if (ev.target.files?.length) addPhotos(ev.target.files); ev.target.value = ""; }} />
      </div>

      <div>
        <div className="text-[11px] font-semibold text-ink mb-1">Video publicitario</div>
        <div className="flex gap-2 flex-wrap items-center">
          {videos.map((u, i) => (
            <div key={i} className="flex items-center gap-1 rounded border border-rule px-2 py-1 text-[11.5px] text-teal">
              <Film size={12} /> Video {i + 1}
              <button type="button" className="text-steel hover:text-white cursor-pointer" onClick={() => setVideos((s) => s.filter((_, j) => j !== i))}><X size={12} /></button>
            </div>
          ))}
          {videos.length < 5 && (
            <button type="button" className="flex items-center gap-1.5 rounded border border-rule px-2.5 py-1.5 text-[12px] text-steel cursor-pointer hover:border-teal" onClick={() => videoRef.current?.click()}>
              {uploading === "video" ? <span className="w-3 h-3 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={13} />} Subir video
            </button>
          )}
        </div>
        <input ref={videoRef} type="file" accept="video/*" className="hidden" onChange={(ev) => { if (ev.target.files?.[0]) addVideo(ev.target.files[0]); ev.target.value = ""; }} />
        <div className="relative mt-1.5" style={{ maxWidth: 420 }}>
          <Link2 size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-steel" />
          <input
            type="url"
            value={driveLink}
            onChange={(ev) => setDriveLink(ev.target.value)}
            placeholder="…o pega el enlace de Drive del video (si pesa más de 50MB)"
            className="w-full rounded border border-rule bg-surface pl-8 pr-2.5 py-1.5 text-[12px]"
          />
        </div>
      </div>

      {err && <div className="text-red text-[12px]">{err}</div>}

      {asking ? (
        <div className="flex items-center gap-2 bg-gold/10 border border-gold/35 rounded px-2.5 py-2" style={{ maxWidth: 420 }}>
          <span className="flex-1 text-[11.5px]" style={{ color: "#D9A441" }}>¿Seguro que ya hiciste todo el brandeo?</span>
          <button type="button" disabled={busy} className="text-[11.5px] font-bold text-teal cursor-pointer disabled:opacity-60" onClick={finish}>Sí</button>
          <button type="button" className="text-[11.5px] text-steel cursor-pointer" onClick={() => setAsking(false)}>No</button>
        </div>
      ) : (
        <button
          type="button"
          disabled={!ready}
          className="self-start flex items-center gap-1.5 rounded border border-blue bg-blue px-3.5 py-2 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => setAsking(true)}
        >
          <CheckCircle2 size={14} /> Terminar brandeo
          {!ready && !uploading && <span className="font-normal text-white/80">(falta {photos.length === 0 ? "foto" : "video"})</span>}
        </button>
      )}
    </div>
  );
}

function ChannelCheck({ e, canAct, onDone }: { e: Entry; canAct: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const checked = !!e.channel;

  async function toggle() {
    setBusy(true);
    await fetch("/api/new-id-branding/channel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogItemId: e.catalogItemId, proposalId: e.proposalId, uploaded: !checked }),
    }).catch(() => null);
    setBusy(false);
    onDone();
  }

  return (
    <label className={`flex items-center gap-2 text-[12.5px] ${canAct ? "cursor-pointer" : ""}`}>
      <input type="checkbox" checked={checked} disabled={!canAct || busy} onChange={toggle} className="w-4 h-4 accent-teal" />
      <span className={checked ? "text-teal" : "text-steel"}>
        {checked ? `Subido al canal de la marca — ${actorName(e.channel!.by)} · ${formatDateTime(e.channel!.at)}` : "Ya subido al canal de la marca"}
      </span>
    </label>
  );
}

// Confirmado 2026-09-23, pedido de Robert: los IDs nuevos por brandear tienen
// su propia pestaña, separada de Mercadería recibida. Cada producto aparece
// una sola vez; al terminar pasa al historial con sus fotos, video(s) y la
// casilla de "subido al canal de la marca".
export function NewIdBrandingPanel() {
  const [data, setData] = useState<{ pending: Entry[]; done: Entry[]; canAct: boolean } | null>(null);
  const [view, setView] = useState<"pending" | "done">("pending");
  const [search, setSearch] = useState("");

  function load() {
    fetch("/api/new-id-branding")
      .then((r) => (r.ok ? r.json() : { pending: [], done: [], canAct: false }))
      .then(setData)
      .catch(() => setData({ pending: [], done: [], canAct: false }));
  }
  useEffect(load, []);

  if (!data) return <div className="text-steel text-[13px]">Cargando…</div>;

  const query = search.trim().toLowerCase();
  const list = (view === "pending" ? data.pending : data.done).filter(
    (e) => !query || e.name.toLowerCase().includes(query) || e.code?.toLowerCase().includes(query)
  );
  const notOnChannel = data.done.filter((e) => !e.channel).length;

  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1 text-[11.5px] font-semibold cursor-pointer transition-colors ${active ? "border-blue bg-blue text-white" : "border-rule text-steel hover:border-blue/50"}`;

  return (
    <div className="flex flex-col gap-3">
      <TabGuide storageKey="nuevos-ids-brandear">
        {data.canAct ? (
          <>Acá aparece cada producto nuevo <b>una sola vez</b>: cuando llega a bodega por primera vez o cuando Heidy confirma su ID de Dropi. Sube las fotos reales brandeadas y el video, y toca &quot;Terminar brandeo&quot;. Después, en Historial, marca la casilla cuando ya lo subiste al canal de la marca.</>
        ) : (
          <>Vista de solo lectura: qué productos nuevos faltan por brandear y el historial de los que ya se brandearon, con sus fotos y videos.</>
        )}
      </TabGuide>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={pill(view === "pending")} onClick={() => setView("pending")}>
          Por brandear ({data.pending.length})
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

      {list.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13.5px]">
          {query ? <>No se encontró ningún producto con &quot;{search.trim()}&quot;.</> : view === "pending" ? "No hay IDs nuevos por brandear." : "Todavía no hay IDs brandeados."}
        </div>
      )}

      {list.map((e) => (
        <div key={e.key} className="bg-surface border border-rule rounded-md p-4">
          <div className="text-[14.5px] font-bold mb-0.5 flex items-center gap-1.5">
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
              {data.canAct ? (
                <BrandForm e={e} onDone={load} />
              ) : (
                <div className="flex items-center gap-1.5 text-[12px] text-steel pt-3 border-t border-rule">
                  <Camera size={14} /> Todavía pendiente de brandeo
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-1.5 text-[12px] text-teal">
                <CheckCircle2 size={14} /> Brandeado — {actorName(e.branded?.by ?? null)}{e.branded?.at ? ` · ${formatDateTime(e.branded.at)}` : ""}
              </div>
              {e.branded?.legacy ? (
                <div className="text-[11.5px] text-steel">Se confirmó antes de que existiera esta sección, por eso no tiene fotos ni video guardados aquí.</div>
              ) : (
                <>
                  <div className="flex flex-wrap border border-rule rounded-md overflow-hidden">
                    <Thumbs label="Fotos reales brandeadas" urls={e.branded?.photos ?? []} />
                  </div>
                  <Videos urls={e.branded?.videoUrls ?? []} />
                </>
              )}
              <div className="pt-3 border-t border-rule">
                <ChannelCheck e={e} canAct={data.canAct} onDone={load} />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
