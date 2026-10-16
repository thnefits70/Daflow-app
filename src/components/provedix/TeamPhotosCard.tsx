"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Data = {
  pool: { driveId: string; src: string; title: string; kind: "portrait" | "work"; fromDrive: boolean }[];
  rejected: { driveId: string; reason: string; at: string }[];
};

// Fotos del equipo en provedix.com (2026-10-16): las revisa el servidor solo
// los días 1 y 15. Aquí el admin ve cuáles están, puede quitar cualquiera y
// revisar el Drive en el momento.
export function TeamPhotosCard({ data }: { data: Data }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // Oculta por defecto (2026-10-16): se abre con un clic en el título.
  const [open, setOpen] = useState(false);

  async function syncNow() {
    setBusy("sync");
    setMsg(null);
    const res = await fetch("/api/provedix/team-photos", { method: "POST" }).catch(() => null);
    const d = res ? await res.json().catch(() => null) : null;
    setBusy(null);
    if (!res?.ok) return setMsg(d?.error ?? "No se pudo revisar el Drive.");
    setMsg(
      d.reviewed === 0 && !d.rejected?.length
        ? "No hay fotos nuevas en la carpeta."
        : `Listo: ${d.approved.length} aprobada(s), ${d.rejected.length} descartada(s)${d.retired.length ? `, ${d.retired.length} reemplazada(s)` : ""}.${d.error ? ` ${d.error}` : ""}`,
    );
    router.refresh();
  }

  async function remove(driveId: string) {
    if (!confirm("¿Quitar esta foto de provedix.com?")) return;
    setBusy(driveId);
    const res = await fetch(`/api/provedix/team-photos?driveId=${encodeURIComponent(driveId)}`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return setMsg("No se pudo quitar la foto.");
    router.refresh();
  }

  return (
    <div className="bg-surface border border-rule rounded-lg p-5 mb-5">
      <div className={`flex items-center justify-between gap-3 flex-wrap ${open ? "mb-1" : ""}`}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 text-[13px] font-semibold cursor-pointer hover:opacity-80"
        >
          <span className={`inline-block text-[10px] text-steel transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
          Fotos del equipo en la página ({data.pool.length})
          {!open && <span className="text-[12px] font-normal text-steel">· Ver fotos</span>}
        </button>
        {open && <button
          type="button"
          onClick={syncNow}
          disabled={busy !== null}
          className="rounded-full border border-rule bg-cloud px-3 py-1.5 text-[12px] font-semibold hover:bg-rule disabled:opacity-60 cursor-pointer"
        >
          {busy === "sync" ? "Revisando el Drive…" : "Revisar Drive ahora"}
        </button>}
      </div>
      {open && <>
      <p className="text-[12px] text-steel mb-4 max-w-[640px]">
        Los días 1 y 15 de cada mes el sistema revisa solo la carpeta de Drive, descarta las fotos con datos de clientes, proveedores o la ubicación, y
        publica solo las mejores (máximo 14). La página muestra 6 y las cambia cada lunes. Puedes quitar cualquier foto.
      </p>
      {msg && <div className="mb-3 rounded-md bg-cloud px-3 py-2 text-[12px]">{msg}</div>}
      <ul className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-2">
        {data.pool.map((p) => (
          <li key={p.driveId} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.src} alt={p.title} className="aspect-[3/4] w-full rounded-md object-cover bg-cloud" />
            <div className="mt-1 text-[11px] leading-tight text-steel line-clamp-2">{p.title}</div>
            <div className="text-[10.5px] text-steel">
              {p.kind === "portrait" ? "Retrato" : "Trabajo"}
              {p.fromDrive ? " · nueva" : ""}
            </div>
            <button
              type="button"
              onClick={() => remove(p.driveId)}
              disabled={busy !== null}
              className="absolute right-1 top-1 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-black disabled:opacity-60 cursor-pointer"
            >
              {busy === p.driveId ? "…" : "Quitar"}
            </button>
          </li>
        ))}
      </ul>
      {data.rejected.length > 0 && (
        <div className="mt-4">
          <div className="text-[12px] font-semibold mb-1">Últimas fotos descartadas</div>
          <ul className="text-[12px] text-steel flex flex-col gap-0.5">
            {data.rejected.map((r) => (
              <li key={r.driveId}>
                {new Date(r.at).toLocaleDateString("es-EC")} · {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      </>}
    </div>
  );
}
