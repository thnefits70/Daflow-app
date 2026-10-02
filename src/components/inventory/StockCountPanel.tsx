"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, Search } from "lucide-react";
import type { CountView } from "@/lib/stockCount";
import { WAREHOUSE_AREAS, areaLabel } from "@/lib/warehouseAreas";

type Data = { count: CountView | null; fullCompleted: boolean; weeklyArea: string | null; isLead: boolean };

// Conteo físico de inventario (pedido del usuario 2026-10-02). A CIEGAS:
// aquí nunca se ve lo que dice el sistema, solo se escribe cuánto hay.
export function StockCountPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [area, setArea] = useState<string>("");
  const [q, setQ] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  function load() {
    fetch("/api/stock-count", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }
  useEffect(load, []);

  const count = data?.count ?? null;
  const visible = useMemo(() => {
    if (!count) return [];
    const nq = q.trim().toLowerCase();
    return count.products.filter((p) => (count.kind === "WEEKLY_AREA" || !area || (area === "NONE" ? !p.area : p.area === area)) && (!nq || p.name.toLowerCase().includes(nq) || (p.justCode ?? "").includes(nq)));
  }, [count, area, q]);

  async function save(productId: string) {
    if (!count) return;
    const raw = drafts[productId];
    if (raw === undefined || raw.trim() === "") return;
    const quantity = Number(raw);
    if (!Number.isInteger(quantity) || quantity < 0) return setErr("Escribe una cantidad entera, 0 o mayor.");
    setSaving(productId);
    setErr("");
    const res = await fetch(`/api/stock-count/${count.id}/line`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ catalogItemId: productId, quantity }) });
    const json = await res.json().catch(() => null);
    setSaving(null);
    if (!res.ok) return setErr(json?.error ?? "No se pudo guardar.");
    setDrafts((d) => {
      const n = { ...d };
      delete n[productId];
      return n;
    });
    load();
  }

  async function start() {
    setBusy(true);
    const res = await fetch("/api/stock-count", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start-full" }) });
    setBusy(false);
    setConfirmStart(false);
    if (!res.ok) setErr((await res.json().catch(() => null))?.error ?? "No se pudo iniciar.");
    load();
  }

  async function send() {
    if (!count) return;
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/stock-count/${count.id}/submit`, { method: "POST" });
    const json = await res.json().catch(() => null);
    setBusy(false);
    setConfirmSend(false);
    if (!res.ok) return setErr(json?.error ?? "No se pudo enviar.");
    setMsg(json.differences > 0 ? `Enviado: ${json.differences} producto(s) con diferencia pasan a aprobación del administrador.` : "Enviado: todo cuadró, no hay nada que ajustar.");
    load();
  }

  if (!data) return <div className="text-steel text-[13px]">Cargando…</div>;

  if (!count) {
    return (
      <div className="text-[13px] max-w-xl">
        {msg && <div className="text-teal mb-2">{msg}</div>}
        {data.fullCompleted ? (
          <div className="text-steel">No hay un conteo abierto esta semana.</div>
        ) : data.isLead ? (
          <>
            <p className="mb-2">Todavía no se hizo el conteo general. Antes de empezar, confirma todos los cortes pendientes: lo que ya salió debe estar descontado.</p>
            {confirmStart ? (
              <div className="bg-cloud border border-gold/50 rounded p-2.5">
                ¿Iniciar el conteo general de toda la bodega? Tu equipo podrá contar desde el celular.
                <div className="flex gap-2 mt-2">
                  <button type="button" disabled={busy} className="rounded border border-gold bg-gold px-3 py-1.5 font-bold text-navy cursor-pointer" onClick={start}>Sí, iniciar</button>
                  <button type="button" className="text-steel cursor-pointer" onClick={() => setConfirmStart(false)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <button type="button" className="rounded border border-teal bg-teal px-3.5 py-2 font-bold text-navy cursor-pointer" onClick={() => setConfirmStart(true)}>Iniciar conteo general</button>
            )}
          </>
        ) : (
          <div className="text-steel">Todavía no hay un conteo abierto. Daniel lo inicia.</div>
        )}
        {err && <div className="text-red mt-2">{err}</div>}
      </div>
    );
  }

  const counted = count.products.filter((p) => p.countedQty !== null).length;
  const total = count.products.length;
  const locked = count.status !== "COUNTING";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <h2 className="font-display text-[17px] font-bold flex items-center gap-2">
          <ClipboardList size={17} /> {count.kind === "FULL" ? "Conteo general" : `Conteo semanal · ${areaLabel(count.area)}`}
        </h2>
        <span className="text-[12.5px] text-steel">
          Contados <b className="text-ink">{counted}</b> de {total}
        </span>
        {locked && <span className="text-[11px] font-bold uppercase rounded-full px-2 py-0.5 border border-gold/50 bg-gold/15">{count.status === "SUBMITTED" ? "Enviado — esperando aprobación" : "Aprobado"}</span>}
      </div>
      <div className="text-[12px] bg-cloud border border-rule rounded p-2.5 mb-3 max-w-2xl">
        Cuenta lo que hay físicamente en la percha y escribe el número. <b>No cuentes</b> lo que ya está separado para un corte. Si un producto no está, escribe <b>0</b>.
      </div>
      {msg && <div className="text-teal text-[12.5px] mb-2">{msg}</div>}
      {err && <div className="text-red text-[12.5px] mb-2">{err}</div>}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {count.kind === "FULL" && (
          <>
            <button type="button" className={`rounded-full border px-2.5 py-1 text-[12px] cursor-pointer ${area === "" ? "bg-teal border-teal text-navy font-bold" : "border-rule"}`} onClick={() => setArea("")}>Todas</button>
            {[...WAREHOUSE_AREAS, "NONE"].map((a) => {
              const inArea = count.products.filter((p) => (a === "NONE" ? !p.area : p.area === a));
              const done = inArea.filter((p) => p.countedQty !== null).length;
              return (
                <button key={a} type="button" className={`rounded-full border px-2.5 py-1 text-[12px] cursor-pointer ${area === a ? "bg-teal border-teal text-navy font-bold" : done === inArea.length && inArea.length > 0 ? "border-green bg-green/15" : "border-rule"}`} onClick={() => setArea(a)}>
                  {a === "NONE" ? "Sin área" : `Área ${a}`} <span className="font-mono">{done}/{inArea.length}</span>
                </button>
              );
            })}
          </>
        )}
        <span className="relative">
          <Search size={13} className="absolute left-2 top-2 text-steel" />
          <input className="rounded border border-rule bg-surface pl-7 pr-2 py-1 text-[12.5px] w-56" placeholder="Buscar producto o ID" value={q} onChange={(e) => setQ(e.target.value)} />
        </span>
      </div>

      <div className="flex flex-col gap-1.5 max-w-3xl">
        {visible.map((p) => (
          <div key={p.id} className={`flex items-center gap-2 border rounded p-2 text-[12.5px] ${p.countedQty !== null ? "border-green/50 bg-green/5" : "border-rule"}`}>
            {p.photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.photo} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{p.name}</div>
              <div className="text-steel font-mono text-[11px]">
                {p.justCode ?? "sin ID"} · {areaLabel(p.area)}
                {p.countedQty !== null && ` · contado ${p.countedQty}${p.countedByName ? ` por ${p.countedByName}` : ""}`}
              </div>
            </div>
            {!locked && (
              <>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className="w-20 rounded border border-rule bg-surface px-2 py-1.5 text-[14px] text-right"
                  placeholder={p.countedQty !== null ? String(p.countedQty) : "¿Cuántos?"}
                  value={drafts[p.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && save(p.id)}
                />
                <button type="button" disabled={saving === p.id || !(drafts[p.id] ?? "").trim()} className="rounded border border-teal bg-teal px-2.5 py-1.5 font-bold text-navy cursor-pointer disabled:opacity-40" onClick={() => save(p.id)}>
                  {saving === p.id ? "…" : p.countedQty !== null ? "Corregir" : "Guardar"}
                </button>
              </>
            )}
            {p.countedQty !== null && <CheckCircle2 size={15} className="text-green shrink-0" />}
          </div>
        ))}
      </div>

      {data.isLead && !locked && (
        <div className="mt-4 max-w-2xl">
          {confirmSend ? (
            <div className="bg-cloud border border-gold/50 rounded p-3 text-[12.5px]">
              <b>¿Enviar el conteo?</b> Ya no se podrá cambiar lo contado. Las diferencias le llegan al administrador en una lista para aprobarlas.
              {counted < total && <div className="text-gold font-semibold mt-1">Faltan {total - counted} producto(s) por contar: esos no se ajustan.</div>}
              <div className="flex gap-2 mt-2">
                <button type="button" disabled={busy} className="rounded border border-gold bg-gold px-3 py-1.5 font-bold text-navy cursor-pointer" onClick={send}>{busy ? "Enviando…" : "Sí, enviar"}</button>
                <button type="button" className="text-steel cursor-pointer" onClick={() => setConfirmSend(false)}>Cancelar</button>
              </div>
            </div>
          ) : (
            <button type="button" disabled={counted === 0} className="rounded border border-teal bg-teal px-3.5 py-2 font-bold text-navy cursor-pointer disabled:opacity-50" onClick={() => setConfirmSend(true)}>
              Revisé el conteo — enviar a aprobación ({counted}/{total})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
