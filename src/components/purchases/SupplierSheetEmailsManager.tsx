"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { formatDateTime } from "@/lib/formatDateTime";

type Row = { id: string; email: string; canWrite: boolean; side: "SUPPLIER" | "OWN"; createdAt: string; lastAccessAt: string | null };

// Confirmado 2026-09-24, pedido explícito del usuario: lista de correos que
// pueden abrir la hoja de cálculo de CHEN — solo el admin la ve y la cambia.
// Aunque alguien tenga el enlace, sin un correo de esta lista no entra.
export function SupplierSheetEmailsManager({ supplierId }: { supplierId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const api = `/api/supplier-debt/${supplierId}/sheet-emails`;

  useEffect(() => {
    let alive = true;
    fetch(api)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Row[]) => {
        if (alive) setRows(d);
      })
      .catch(() => {
        if (alive) setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [api]);

  async function send(init: RequestInit, url = api) {
    setErr("");
    setBusy(true);
    const res = await fetch(url, init).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const d = await res?.json().catch(() => ({}));
      setErr(d?.error ?? "No se pudo guardar.");
      return false;
    }
    setRows(await res.json());
    return true;
  }

  async function add() {
    if (!draft.trim()) return;
    const ok = await send({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emails: draft }) });
    if (ok) setDraft("");
  }

  return (
    <div className="mt-2 rounded border border-rule bg-surface px-3 py-2.5 text-[12px]">
      <div className="mb-1.5 font-semibold text-ink">Correos con acceso a la hoja</div>
      <p className="mb-2 text-steel">
        Solo estos correos pueden abrirla, aunque otra persona tenga el enlace. Puedes pegar varios juntos. Marca bien el equipo de cada
        correo: lo que escribe un equipo, el otro nunca lo puede cambiar ni borrar.
      </p>
      <div className="mb-2 flex gap-2">
        <textarea
          rows={1}
          className="min-w-0 flex-1 resize-y rounded border border-rule bg-cloud px-2 py-1.5 text-[12.5px] text-ink"
          placeholder="correo@gmail.com, otro@gmail.com"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="button"
          className="shrink-0 rounded border border-rule bg-surface px-3 py-1.5 font-semibold text-ink cursor-pointer disabled:opacity-60"
          onClick={add}
          disabled={busy || !draft.trim()}
        >
          Agregar
        </button>
      </div>
      {err && <div className="mb-2 text-red">{err}</div>}
      {rows === null ? (
        <div className="text-steel">Cargando…</div>
      ) : rows.length === 0 ? (
        <div className="text-steel">Todavía no hay ningún correo — nadie puede abrir la hoja.</div>
      ) : (
        <div className="flex flex-col divide-y divide-rule">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
              <span className="min-w-0 flex-1 break-all font-medium text-ink">{r.email}</span>
              <span className="text-steel">{r.lastAccessAt ? `Último ingreso ${formatDateTime(r.lastAccessAt)}` : "Nunca entró"}</span>
              {/* Confirmado 2026-09-24 (antifraude): de qué lado es cada correo. */}
              <select
                className={`rounded border px-1.5 py-0.5 ${r.side === "OWN" ? "border-blue/50 bg-blue/10 text-ink" : "border-rule bg-cloud text-ink"}`}
                value={r.side}
                disabled={busy}
                onChange={(e) => void send({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, side: e.target.value }) })}
              >
                <option value="SUPPLIER">Equipo Chen</option>
                <option value="OWN">Nuestro equipo</option>
              </select>
              <select
                className="rounded border border-rule bg-cloud px-1.5 py-0.5 text-ink"
                value={r.canWrite ? "write" : "read"}
                disabled={busy}
                onChange={(e) =>
                  void send({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, canWrite: e.target.value === "write" }) })
                }
              >
                <option value="write">Puede escribir</option>
                <option value="read">Solo ver</option>
              </select>
              <button
                type="button"
                className="text-steel hover:text-red cursor-pointer disabled:opacity-60"
                title="Quitar acceso"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`¿Quitarle el acceso a ${r.email}? Deja de poder abrir la hoja al instante.`)) void send({ method: "DELETE" }, `${api}?id=${r.id}`);
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
