"use client";

import { useEffect, useState } from "react";
import { Camera, Check, Loader2, X } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { formatDateTime } from "@/lib/formatDateTime";

type Row = {
  id: string;
  code: string;
  guideNumber: string;
  carrier: string;
  createdAt: string;
  michelleStatus: string | null;
  michelleOutOfHours: boolean;
  michelleNote: string | null;
  michelleDecidedAt: string | null;
  decidedByName: string | null;
  retainedAt: string | null;
  retainedByName: string | null;
  retainedPhotoUrl: string | null;
  items: { declaredName: string; quantity: number }[];
};

const STATUS: Record<string, { label: string; cls: string }> = {
  POR_APROBAR: {
    label: "Fuera de horario · Daniel decide",
    cls: "bg-gold/20 text-ink",
  },
  POR_RETENER: { label: "Por retener", cls: "bg-red/15 text-red" },
  RETENIDA: { label: "Retenida", cls: "bg-teal/20 text-ink" },
  NO_RETENIDA: { label: "No se retuvo", cls: "bg-cloud text-steel" },
  RECHAZADA: { label: "Rechazada", cls: "bg-cloud text-steel" },
};

// Guías canceladas pedidas por el dropshipper en el chat de Michelle
// (provedix.com, 2026-10-15). Joao (o Daniel/Allan) la retiene con foto en
// vivo; Daniel decide las pedidas fuera de horario. Ver michelleCancellations.ts.
export function MichelleCancellationsPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [canDecide, setCanDecide] = useState(false);
  const [canRetain, setCanRetain] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/cancelled-guides/michelle")
      .then((r) => r.json())
      .then((d) => {
        setRows(Array.isArray(d?.rows) ? d.rows : []);
        setCanDecide(!!d?.canDecide);
        setCanRetain(!!d?.canRetain);
        setDenied(!Array.isArray(d?.rows));
      })
      .catch(() => setRows([]));
  }
  useEffect(load, []);

  async function act(id: string, payload: Record<string, string>) {
    setBusy(id);
    setError("");
    const res = await fetch(`/api/cancelled-guides/michelle/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await res.json().catch(() => null);
    if (!res.ok) setError(d?.error ?? "No se pudo guardar.");
    setBusy(null);
    load();
  }

  async function retainWithPhoto(id: string, files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(id);
    setError("");
    const up = await uploadFile(file, "cancelled-guide-photos");
    if (!up.ok) {
      setBusy(null);
      setError(up.error);
      return;
    }
    await act(id, { action: "retained", photoUrl: up.url });
  }

  if (rows === null)
    return <div className="text-[12.5px] text-steel">Cargando…</div>;
  if (denied)
    return (
      <div className="text-[12.5px] text-steel">
        Esta sección es del equipo de Inventarios.
      </div>
    );
  const open = rows.filter(
    (r) =>
      r.michelleStatus === "POR_APROBAR" || r.michelleStatus === "POR_RETENER",
  );
  const done = rows.filter((r) => !open.includes(r));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-steel">
        Guías que el dropshipper canceló y pidió retener por el chat de Michelle
        (provedix.com). Búscala, retenla y toma la foto en ese momento: con eso
        vuelve sola al stock y el dropshipper ve la foto en el chat.
      </p>
      {error && <div className="text-[12px] text-red">{error}</div>}
      {open.length === 0 && (
        <div className="text-[12.5px] text-steel bg-cloud border border-rule rounded-lg px-3 py-3">
          No hay guías por retener. ✅
        </div>
      )}
      {open.map((r) => (
        <div
          key={r.id}
          className="border border-rule rounded-lg p-3 bg-surface"
        >
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <div className="font-mono text-[15px] font-bold">
                {r.guideNumber}
              </div>
              <div className="text-[12px] text-steel">
                {r.carrier} · {r.code} · pedida {formatDateTime(r.createdAt)}
              </div>
            </div>
            <span
              className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${STATUS[r.michelleStatus ?? ""]?.cls ?? ""}`}
            >
              {STATUS[r.michelleStatus ?? ""]?.label}
            </span>
          </div>
          {r.items.length > 0 && (
            <div className="text-[12px] mt-1.5">
              {r.items
                .map((i) => `${i.quantity} × ${i.declaredName}`)
                .join(" · ")}
            </div>
          )}
          {r.michelleNote && (
            <div className="text-[11.5px] text-steel mt-1">
              {r.michelleNote}
            </div>
          )}
          {canRetain && (
            <div className="flex flex-wrap gap-2 mt-2.5">
              {r.michelleStatus === "POR_APROBAR" &&
                (canDecide ? (
                  <>
                    <button
                      type="button"
                      disabled={busy === r.id}
                      onClick={() => act(r.id, { action: "accept" })}
                      className="rounded border border-teal bg-teal px-2.5 py-1 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-50"
                    >
                      Aceptar: que la busquen
                    </button>
                    <button
                      type="button"
                      disabled={busy === r.id}
                      onClick={() => act(r.id, { action: "reject" })}
                      className="rounded border border-rule px-2.5 py-1 text-[12px] font-semibold cursor-pointer disabled:opacity-50"
                    >
                      No se puede
                    </button>
                  </>
                ) : (
                  <span className="text-[12px] text-steel">
                    Esperando que Daniel decida.
                  </span>
                ))}
              {r.michelleStatus === "POR_RETENER" && (
                <>
                  <label
                    className={`inline-flex items-center gap-1.5 rounded border border-teal bg-teal px-2.5 py-1 text-[12px] font-bold text-navy cursor-pointer ${busy === r.id ? "opacity-50 pointer-events-none" : ""}`}
                  >
                    {busy === r.id ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Camera size={13} />
                    )}{" "}
                    Retenida: tomar foto
                    {/* capture: abre la cámara directo en el celular (foto en vivo). */}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => retainWithPhoto(r.id, e.target.files)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() =>
                      window.confirm(
                        "¿La guía ya había salido con la transportadora?",
                      ) &&
                      act(r.id, { action: "not_retained", reason: "ya_salio" })
                    }
                    className="rounded border border-rule px-2.5 py-1 text-[12px] font-semibold cursor-pointer disabled:opacity-50"
                  >
                    Ya había salido
                  </button>
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() =>
                      window.confirm("¿No la encontraron en bodega?") &&
                      act(r.id, {
                        action: "not_retained",
                        reason: "no_encontrada",
                      })
                    }
                    className="rounded border border-rule px-2.5 py-1 text-[12px] font-semibold cursor-pointer disabled:opacity-50"
                  >
                    No se encontró
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ))}

      {done.length > 0 && (
        <div>
          <div className="text-[12px] font-semibold mb-1.5">
            Últimos 15 días
          </div>
          <div className="flex flex-col">
            {done.map((r) => (
              <div
                key={r.id}
                className="border-t border-rule py-2 flex items-center gap-3 text-[12px]"
              >
                {r.retainedPhotoUrl ? (
                  <a
                    href={r.retainedPhotoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={r.retainedPhotoUrl}
                      alt={`Foto de la guía ${r.guideNumber} retenida`}
                      className="h-12 w-12 rounded object-cover border border-rule"
                    />
                  </a>
                ) : (
                  <span className="h-12 w-12 shrink-0 rounded bg-cloud grid place-items-center text-steel">
                    {r.michelleStatus === "RETENIDA" ? (
                      <Check size={16} />
                    ) : (
                      <X size={16} />
                    )}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-mono font-semibold">
                    {r.guideNumber}{" "}
                    <span className="font-sans font-normal text-steel">
                      · {r.carrier}
                    </span>
                  </div>
                  <div className="text-steel">
                    {r.michelleStatus === "RETENIDA"
                      ? `Retenida por ${r.retainedByName ?? "—"} · ${r.retainedAt ? formatDateTime(r.retainedAt) : ""}`
                      : `${STATUS[r.michelleStatus ?? ""]?.label ?? ""}${r.michelleNote ? ` · ${r.michelleNote}` : ""}${r.decidedByName ? ` · ${r.decidedByName}` : ""}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
