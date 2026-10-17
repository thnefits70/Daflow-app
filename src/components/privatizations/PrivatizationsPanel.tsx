"use client";

import { useCallback, useEffect, useState } from "react";
import { Lock, Phone, RefreshCw } from "lucide-react";
import type { PrivatizationRole, PrivatizationRow, privatizationKpis } from "@/lib/privatizations";
import { formatDateTime } from "@/lib/formatDateTime";

// Productos privatizados en Dropi (2026-10-17). Michelle y Yair registran,
// Bryan aprueba, el asesor desprivatiza directo. DAFLOW mide solo las ventas
// con los cortes y NICK y dice qué pasó. El admin lo ve en solo lectura.

type Kpis = ReturnType<typeof privatizationKpis>;
type Data = { role: PrivatizationRole; accounts: string[]; rows: PrivatizationRow[]; kpis: Kpis };

const HEALTH: Record<string, { text: string; cls: string }> = {
  CUMPLIDA: { text: "Meta cumplida", cls: "bg-green/15 text-green" },
  CUMPLIENDO: { text: "Cumpliendo", cls: "bg-green/15 text-green" },
  ATRASADA: { text: "Atrasada", cls: "bg-amber/20 text-amber" },
  SIN_VENTAS: { text: "Sin ventas", cls: "bg-red/15 text-red" },
  VENCIDA: { text: "Venció", cls: "bg-red/15 text-red" },
};
const OUTCOME: Record<string, { text: string; cls: string }> = {
  CUMPLIO: { text: "Cumplió", cls: "bg-green/15 text-green" },
  A_MEDIAS: { text: "Cumplió a medias", cls: "bg-amber/20 text-amber" },
  NO_CUMPLIO: { text: "No cumplió", cls: "bg-red/15 text-red" },
};
const STATUS: Record<string, string> = {
  APPROVAL: "Por aprobar (Bryan)",
  APPROVED: "Aprobada: falta privatizar en Dropi",
  ACTIVE: "Privatizada",
  ENDED: "Desprivatizada",
  REJECTED: "No aprobada",
  CANCELLED: "Retirada",
};
const fmtDay = (iso: string) => new Date(new Date(iso).getTime() - 5 * 3600e3).toISOString().slice(0, 10).split("-").reverse().join("/");
const tomorrow = () => new Date(Date.now() - 5 * 3600e3 + 864e5).toISOString().slice(0, 10);

function Card({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="bg-surface border border-rule rounded-lg p-3">
      <div className="text-[11px] text-steel">{label}</div>
      <div className={`font-display text-[22px] font-bold tabular-nums ${tone ?? ""}`}>{value}</div>
      {sub && <div className="text-[10.5px] text-steel">{sub}</div>}
    </div>
  );
}

function NewPrivatization({ accounts, onDone }: { accounts: string[]; onDone: () => void }) {
  const [f, setF] = useState({ account: accounts[0] ?? "", productId: "", productName: "", units: "", email: "", storeName: "", phone: "", goalUnits: "", deadline: "", note: "" });
  const [product, setProduct] = useState<{ name: string | null; stock: number | null; publicUnits: number | null; privatizedUnits: number } | null>(null);
  const [track, setTrack] = useState<{ total: number; met: number; half: number; failed: number; warn: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const lookup = () => {
    if (f.productId.trim().length < 2) return;
    fetch(`/api/privatizations?product=${encodeURIComponent(f.productId.trim())}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setProduct(d));
  };
  const lookupEmail = () => {
    if (!f.email.includes("@")) return;
    fetch(`/api/privatizations?email=${encodeURIComponent(f.email.trim())}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setTrack(d));
  };

  const submit = async () => {
    if (track?.warn && !confirm(`⚠️ Este dropshipper cumplió ${track.met} de ${track.total} privatizaciones. ¿Seguro que quieres pedir otra?`)) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/privatizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account: f.account,
        productId: f.productId,
        productName: product?.name ? null : f.productName || null,
        units: Number(f.units),
        email: f.email,
        storeName: f.storeName,
        phone: f.phone,
        goalUnits: Number(f.goalUnits),
        deadline: f.deadline,
        note: f.note || null,
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg({ ok: true, text: `Listo: ${d.code} quedó por aprobar. Bryan la revisa en su Inicio.` });
      setF((x) => ({ ...x, productId: "", productName: "", units: "", email: "", storeName: "", phone: "", goalUnits: "", deadline: "", note: "" }));
      setProduct(null);
      setTrack(null);
      onDone();
    } else setMsg({ ok: false, text: d.error ?? "No se pudo registrar." });
    setBusy(false);
  };

  const input = "bg-surface border border-rule rounded px-2 py-1.5 text-[12.5px] w-full";
  return (
    <div className="bg-surface border border-rule rounded-lg p-4">
      <div className="text-[13px] font-semibold mb-1">Pedir una privatización</div>
      <div className="text-[11.5px] text-steel mb-3">
        Llénalo antes de privatizar en Dropi. Bryan la aprueba y recién ahí la privatizas. Escribe el nombre de la tienda tal como sale en sus etiquetas: con eso DAFLOW mide solo cuánto vende.
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-[12px]">
        <label className="flex flex-col gap-1">
          Cuenta de Dropi
          <select className={input} value={f.account} onChange={(e) => set("account", e.target.value)}>
            {accounts.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          ID del producto
          <input className={input} value={f.productId} onChange={(e) => set("productId", e.target.value)} onBlur={lookup} placeholder="Ej. 194440" />
          {product && (
            <span className="text-[11px] text-steel">
              {product.name ?? "No está en el catálogo: escribe el nombre abajo"}
              {product.stock != null && ` · stock ${product.stock} · públicas ${product.publicUnits}${product.privatizedUnits ? ` (privatizadas ${product.privatizedUnits})` : ""}`}
            </span>
          )}
        </label>
        {product && !product.name && (
          <label className="flex flex-col gap-1">
            Nombre del producto
            <input className={input} value={f.productName} onChange={(e) => set("productName", e.target.value)} />
          </label>
        )}
        <label className="flex flex-col gap-1">
          Unidades a privatizar
          <input className={input} type="number" min={1} value={f.units} onChange={(e) => set("units", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          Correo del dropshipper (el de Dropi)
          <input className={input} type="email" value={f.email} onChange={(e) => set("email", e.target.value)} onBlur={lookupEmail} />
          {track && (
            <span className={`text-[11px] ${track.warn ? "text-red font-semibold" : "text-steel"}`}>
              {track.total
                ? `${track.warn ? "⚠️ " : ""}Historial: cumplió ${track.met}, a medias ${track.half}, no cumplió ${track.failed} (de ${track.total})`
                : "Dropshipper nuevo: sin privatizaciones antes"}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1">
          Nombre de la tienda (como sale en la etiqueta)
          <input className={input} value={f.storeName} onChange={(e) => set("storeName", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          Teléfono del dropshipper
          <input className={input} value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="09…" />
        </label>
        <label className="flex flex-col gap-1">
          Meta: unidades que se compromete a vender
          <input className={input} type="number" min={1} value={f.goalUnits} onChange={(e) => set("goalUnits", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          Fecha límite del acuerdo
          <input className={input} type="date" min={tomorrow()} value={f.deadline} onChange={(e) => set("deadline", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
          Nota (opcional)
          <input className={input} value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="Ej. Acordó vender en Quito y Guayaquil" />
        </label>
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-blue text-white px-3.5 py-1.5 text-[12.5px] font-semibold cursor-pointer disabled:opacity-60"
      >
        <Lock size={13} /> {busy ? "Enviando…" : "Enviar a Bryan"}
      </button>
      {msg && <div className={`mt-2 text-[12px] ${msg.ok ? "text-green" : "text-red"}`}>{msg.text}</div>}
    </div>
  );
}

export function PrivatizationsPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/privatizations?k=${reloadKey}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Data) => setData(d))
      .catch(() => setError("No se pudo cargar."));
  }, [reloadKey]);
  useEffect(load, [load]);

  const act = async (id: string, action: "approve" | "reject" | "privatized" | "end", ask?: string) => {
    let note: string | null = null;
    if (ask) {
      note = prompt(ask);
      if (note === null) return;
      if (action === "reject" && !note.trim()) return;
    }
    setBusy(id);
    const res = await fetch(`/api/privatizations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) alert(d.error ?? "No se pudo.");
    setBusy(null);
    setReloadKey((k) => k + 1);
  };

  if (error) return <div className="text-[12px] text-red">{error}</div>;
  if (!data) return <div className="text-[12px] text-steel">Cargando productos privatizados…</div>;
  const { role, rows, kpis } = data;
  const mine = (r: PrivatizationRow) => role.accounts.includes(r.account);
  const open = rows.filter((r) => ["APPROVAL", "APPROVED", "ACTIVE"].includes(r.status));
  const closed = rows.filter((r) => !["APPROVAL", "APPROVED", "ACTIVE"].includes(r.status));
  const order = (r: PrivatizationRow) => ({ SIN_VENTAS: 0, VENCIDA: 0, ATRASADA: 1, APPROVAL: 2, APPROVED: 2 })[r.health ?? r.status] ?? 3;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <div className="font-mono text-[10.5px] tracking-[.14em] uppercase text-steel">KPIs Productos privatizados{role.isAdmin ? " · solo lectura" : ""}</div>
          <div className="text-[11.5px] text-steel mt-1">DAFLOW mide solo las ventas de cada privatización con los cortes (tienda + producto) y NICK. Las unidades que no se privatizan siguen públicas.</div>
        </div>
        <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="inline-flex items-center gap-1 text-[12px] text-blue cursor-pointer">
          <RefreshCw size={12} /> Actualizar
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Card label="Privatizadas activas" value={kpis.active} sub={`${kpis.activeUnits} unidades reservadas`} />
        <Card label="🔴 Sin vender o vencidas" value={kpis.blocked} sub={`${kpis.blockedUnits} u. bloqueadas para otros`} tone={kpis.blocked ? "text-red" : ""} />
        <Card label="🟡 Atrasadas" value={kpis.late} tone={kpis.late ? "text-amber" : ""} />
        <Card label="🟢 Cumpliendo" value={kpis.onTrack} tone="text-green" />
        <Card label="Por aprobar / por privatizar" value={`${kpis.pendingApproval} / ${kpis.toPrivatize}`} />
        <Card
          label="Terminadas"
          value={kpis.endedTotal}
          sub={kpis.endedTotal ? `cumplió ${kpis.endedMet} · a medias ${kpis.endedHalf} · no ${kpis.endedFailed}` : undefined}
        />
      </div>

      {kpis.byAdvisor.length > 0 && (
        <div className="bg-surface border border-rule rounded-lg overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-steel font-mono text-[10px] uppercase tracking-wide">
                <th className="py-2 px-3">Asesor</th>
                <th className="py-2 pr-3 text-right">Activas</th>
                <th className="py-2 pr-3 text-right">Sin vender / vencidas</th>
                <th className="py-2 pr-3 text-right">Terminadas</th>
                <th className="py-2 pr-3 text-right">Cumplieron</th>
                <th className="py-2 pr-3 text-right">A medias</th>
                <th className="py-2 pr-3 text-right">No cumplieron</th>
              </tr>
            </thead>
            <tbody>
              {kpis.byAdvisor.map((a) => (
                <tr key={a.name} className="border-t border-rule">
                  <td className="py-1.5 px-3">{a.name}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{a.active}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${a.blocked ? "text-red font-semibold" : ""}`}>{a.blocked}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{a.ended}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{a.met}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{a.half}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{a.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(kpis.worstDropshippers.length > 0 || kpis.bestDropshippers.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="bg-surface border border-rule rounded-lg p-3">
            <div className="text-[12.5px] font-semibold mb-1">Dropshippers que no cumplen</div>
            {kpis.worstDropshippers.length === 0 && <div className="text-[12px] text-steel">Ninguno todavía.</div>}
            {kpis.worstDropshippers.map((e) => (
              <div key={e.email} className="text-[12px] flex justify-between gap-2 border-t border-rule py-1">
                <span>
                  {e.storeName} <span className="text-steel">· {e.email}</span>
                </span>
                <span className="text-red tabular-nums">
                  no cumplió {e.failed} de {e.total}
                </span>
              </div>
            ))}
          </div>
          <div className="bg-surface border border-rule rounded-lg p-3">
            <div className="text-[12.5px] font-semibold mb-1">Dropshippers que sí cumplen</div>
            {kpis.bestDropshippers.length === 0 && <div className="text-[12px] text-steel">Ninguno todavía.</div>}
            {kpis.bestDropshippers.map((e) => (
              <div key={e.email} className="text-[12px] flex justify-between gap-2 border-t border-rule py-1">
                <span>
                  {e.storeName} <span className="text-steel">· {e.email}</span>
                </span>
                <span className="text-green tabular-nums">
                  cumplió {e.met} de {e.total}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {role.accounts.length > 0 && <NewPrivatization accounts={role.accounts} onDone={() => setReloadKey((k) => k + 1)} />}

      <div className="text-[13px] font-semibold">En curso ({open.length})</div>
      {open.length === 0 && <div className="text-[12px] text-steel">No hay privatizaciones en curso.</div>}
      <div className="flex flex-col gap-2">
        {[...open].sort((a, b) => order(a) - order(b)).map((r) => (
          <div key={r.id} className="bg-surface border border-rule rounded-lg p-3 text-[12px]">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[11px] text-steel">{r.code}</span>
                  <span className="font-semibold">{r.productName}</span>
                  <span className="font-mono text-[11px] text-steel">{r.productId}</span>
                  {r.health ? (
                    <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${HEALTH[r.health].cls}`}>{HEALTH[r.health].text}</span>
                  ) : (
                    <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-steel/15 text-steel">{STATUS[r.status]}</span>
                  )}
                </div>
                <div className="text-steel mt-1">
                  {r.account} · {r.units} u. privatizadas{r.publicUnits != null ? ` (${r.publicUnits} públicas)` : ""} · tienda <b className="text-ink">{r.storeName}</b> · {r.email}
                </div>
                <div className="text-steel">
                  Meta: {r.goalUnits} u. hasta el {fmtDay(r.deadline)} · pidió {r.createdByName}
                  {r.privatizedAt && ` · privatizada el ${fmtDay(r.privatizedAt)}`}
                </div>
                {r.message && <div className={`mt-1 font-semibold ${r.health === "SIN_VENTAS" || r.health === "VENCIDA" ? "text-red" : r.health === "ATRASADA" ? "text-amber" : "text-green"}`}>{r.message}</div>}
                {r.status === "ACTIVE" && (r.delivered || r.returned) ? (
                  <div className="text-steel">
                    De lo vendido: {r.delivered} entregadas · {r.returned} devueltas
                  </div>
                ) : null}
                {r.track.total > 0 && (
                  <div className={r.track.warn ? "text-red" : "text-steel"}>
                    Historial de este dropshipper: cumplió {r.track.met} de {r.track.total}
                  </div>
                )}
                {r.note && <div className="text-steel">Nota: {r.note}</div>}
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 text-blue">
                  <Phone size={12} /> {r.phone}
                </a>
                {!role.isAdmin && role.canApprove && r.status === "APPROVAL" && (
                  <div className="flex gap-1.5">
                    <button type="button" disabled={busy === r.id} onClick={() => act(r.id, "approve")} className="rounded-md bg-green text-white px-2.5 py-1 font-semibold cursor-pointer disabled:opacity-50">
                      Aprobar
                    </button>
                    <button type="button" disabled={busy === r.id} onClick={() => act(r.id, "reject", "¿Por qué no se aprueba?")} className="rounded-md border border-rule px-2.5 py-1 cursor-pointer disabled:opacity-50">
                      No aprobar
                    </button>
                  </div>
                )}
                {mine(r) && r.status === "APPROVED" && (
                  <button type="button" disabled={busy === r.id} onClick={() => act(r.id, "privatized")} className="rounded-md bg-blue text-white px-2.5 py-1 font-semibold cursor-pointer disabled:opacity-50">
                    Ya la privaticé en Dropi
                  </button>
                )}
                {mine(r) && r.status === "ACTIVE" && (
                  <button type="button" disabled={busy === r.id} onClick={() => act(r.id, "end", "Desprivatizar: ¿qué pasó? (opcional)")} className="rounded-md border border-red/50 text-red px-2.5 py-1 cursor-pointer disabled:opacity-50">
                    Ya la desprivaticé
                  </button>
                )}
                {mine(r) && (r.status === "APPROVAL" || r.status === "APPROVED") && (
                  <button type="button" disabled={busy === r.id} onClick={() => act(r.id, "end", "Retirar el pedido: ¿por qué? (opcional)")} className="text-[11px] text-steel underline cursor-pointer">
                    Retirar
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <button type="button" onClick={() => setShowHistory((v) => !v)} className="self-start text-[12px] text-blue underline cursor-pointer">
        {showHistory ? "Ocultar historial" : `Ver historial (${closed.length})`}
      </button>
      {showHistory && (
        <div className="bg-surface border border-rule rounded-lg overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-steel font-mono text-[10px] uppercase tracking-wide">
                <th className="py-2 px-3">Código</th>
                <th className="py-2 pr-3">Producto</th>
                <th className="py-2 pr-3">Tienda</th>
                <th className="py-2 pr-3">Meta</th>
                <th className="py-2 pr-3">Vendió</th>
                <th className="py-2 pr-3">Resultado</th>
                <th className="py-2 pr-3">Cuándo</th>
              </tr>
            </thead>
            <tbody>
              {closed.map((r) => (
                <tr key={r.id} className="border-t border-rule">
                  <td className="py-1.5 px-3 font-mono">{r.code}</td>
                  <td className="py-1.5 pr-3">{r.productName}</td>
                  <td className="py-1.5 pr-3">
                    {r.storeName} <span className="text-steel">· {r.email}</span>
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">{r.goalUnits}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{r.soldUnits ?? "—"}</td>
                  <td className="py-1.5 pr-3">
                    {r.outcome ? (
                      <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${OUTCOME[r.outcome].cls}`}>{OUTCOME[r.outcome].text}</span>
                    ) : (
                      <span className="text-steel">{STATUS[r.status]}{r.reviewNote ? `: ${r.reviewNote}` : ""}</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{r.endedAt ? formatDateTime(r.endedAt) : formatDateTime(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
