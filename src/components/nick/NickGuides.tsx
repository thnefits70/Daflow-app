"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import type { NickGuidesResult } from "@/lib/nick/guides";
import type { NickSyncProgress } from "@/lib/nick/sync";
import { NICK_ATTENTION } from "@/lib/nick/attentionLabels";
import { formatDateTime } from "@/lib/formatDateTime";

// NICK Etapa 1 (2026-10-16): estado en Dropi de cada guía de los cortes.
// Sin montos ni datos del cliente. Se actualiza sola cada 2 horas en
// horario de trabajo; "Actualizar ahora" la corre en el momento.

const GROUPS: { key: string; label: string; cls: string }[] = [
  { key: "PREPARANDO", label: "Preparando", cls: "bg-steel/15 text-steel" },
  { key: "EN_CAMINO", label: "En camino", cls: "bg-blue/15 text-blue" },
  { key: "NOVEDAD", label: "Con novedad", cls: "bg-amber/20 text-amber" },
  { key: "ENTREGADA", label: "Entregada", cls: "bg-green/15 text-green" },
  {
    key: "DEVOLUCION",
    label: "En devolución",
    cls: "bg-orange/15 text-orange",
  },
  { key: "CANCELADA", label: "Cancelada / anulada", cls: "bg-red/15 text-red" },
  {
    key: "NO_ENCONTRADA",
    label: "No encontradas en Dropi",
    cls: "bg-ink/10 text-ink",
  },
];
const GROUP_BY_KEY = new Map(GROUPS.map((g) => [g.key, g]));

function todayEc() {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}
function daysSince(day: string | null) {
  if (!day) return null;
  const ms =
    new Date(`${todayEc()}T12:00:00Z`).getTime() -
    new Date(`${day}T12:00:00Z`).getTime();
  return Math.max(0, Math.round(ms / 864e5));
}
function sinceLabel(iso: string | null) {
  if (!iso) return "—";
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return "menos de 1 h";
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} día${d === 1 ? "" : "s"}`;
}

// isAdmin: "Requiere atención" solo lo ve el admin (pedido del usuario 2026-10-16).
export function NickGuides({ isAdmin = false }: { isAdmin?: boolean }) {
  const [group, setGroup] = useState("");
  // Etapa 2: lista de "Requiere atención" elegida (excluye a group).
  const [attention, setAttention] = useState("");
  const [account, setAccount] = useState("");
  const [carrier, setCarrier] = useState("");
  const [day, setDay] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<NickGuidesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<NickSyncProgress[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (group) p.set("group", group);
    if (attention) p.set("attention", attention);
    if (account) p.set("account", account);
    if (carrier) p.set("carrier", carrier);
    if (day) p.set("day", day);
    if (q) p.set("q", q);
    p.set("page", String(page));
    p.set("k", String(reloadKey));
    return `/api/nick/guides?${p.toString()}`;
  }, [group, attention, account, carrier, day, q, page, reloadKey]);

  const load = useCallback(() => {
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: NickGuidesResult | null) => d && setData(d))
      .finally(() => setLoading(false));
  }, [url]);
  useEffect(load, [load]);

  const setFilter = (fn: () => void) => {
    fn();
    setPage(1);
    setLoading(true);
  };

  const syncNow = async () => {
    setSyncing(true);
    let force = true;
    for (let i = 0; i < 40; i++) {
      const res = await fetch("/api/nick/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      force = false;
      const d = (await res.json().catch(() => ({}))) as {
        progress?: NickSyncProgress[];
      };
      setProgress(d.progress ?? null);
      setReloadKey((k) => k + 1);
      if (!res.ok || !d.progress?.some((p) => p.state === "en_curso")) break;
    }
    setSyncing(false);
  };

  const totalAll = data
    ? Object.entries(data.counts)
        .filter(([k]) => k !== "NO_ENCONTRADA")
        .reduce((a, [, v]) => a + v, 0)
    : 0;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <div className="font-mono text-[10.5px] tracking-[.14em] uppercase text-steel">
            Guías en Dropi · últimos 45 días
          </div>
          <div className="text-[11.5px] text-steel mt-1">
            {data?.lastSyncAt
              ? `Actualizado: ${formatDateTime(data.lastSyncAt)}`
              : "Todavía no se completa la primera actualización."}{" "}
            Se actualiza sola cada 2 horas en horario de trabajo.
          </div>
        </div>
        <button
          type="button"
          onClick={syncNow}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue text-white px-3 py-1.5 text-[12.5px] font-semibold cursor-pointer disabled:opacity-60"
        >
          <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />{" "}
          {syncing ? "Actualizando…" : "Actualizar ahora"}
        </button>
      </div>

      {progress && (
        <div className="mb-3 text-[11.5px] text-steel flex flex-wrap gap-x-4 gap-y-1">
          {progress.map((p) => (
            <span key={p.account}>
              <b className="text-ink">{p.account}:</b>{" "}
              {p.state === "listo"
                ? "al día"
                : p.state === "en_curso"
                  ? `leyendo órdenes del ${p.day ?? "…"}`
                  : p.state === "esperando"
                    ? "en fila"
                    : p.state === "pausada"
                      ? "en pausa: Dropi está marcado como caído (retoma cuando Bryan pulse «Dropi ya volvió»)"
                      : p.state === "desconectada"
                        ? "desconectada — vuelve a conectarla abajo"
                        : (p.message ?? "error")}
            </span>
          ))}
        </div>
      )}

      {isAdmin && (
        <div className="rounded-lg border border-amber/40 bg-amber/5 p-3 mb-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <div className="font-mono text-[10.5px] tracking-[.14em] uppercase text-amber">
              Requiere atención
            </div>
            <div className="text-[10.5px] text-steel">
              Solo lo ves tú: nadie más lo ve y no se envía ningún aviso.
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {NICK_ATTENTION.map((a) => {
              const n = data?.attentionCounts?.[a.key] ?? 0;
              const active = attention === a.key;
              return (
                <button
                  key={a.key}
                  type="button"
                  title={a.hint}
                  onClick={() =>
                    setFilter(() => {
                      setAttention(active ? "" : a.key);
                      setGroup("");
                    })
                  }
                  className={`text-left rounded-lg border p-3 cursor-pointer transition-colors ${active ? "border-amber bg-amber/15" : "border-rule bg-surface hover:bg-surface2"}`}
                >
                  <div className="text-[10.5px] text-steel leading-tight">
                    {a.label}
                  </div>
                  <div
                    className={`font-display text-[22px] font-bold tabular-nums mt-1 ${n > 0 ? "text-amber" : ""}`}
                  >
                    {n.toLocaleString("es-EC")}
                  </div>
                  <div className="text-[9.5px] text-steel leading-tight mt-0.5">
                    {a.hint}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-4">
        {GROUPS.map((g) => {
          const n = data?.counts[g.key] ?? 0;
          const active = group === g.key;
          return (
            <button
              key={g.key}
              type="button"
              onClick={() =>
                setFilter(() => {
                  setGroup(active ? "" : g.key);
                  setAttention("");
                })
              }
              className={`text-left rounded-lg border p-3 cursor-pointer transition-colors ${active ? "border-blue bg-blue/10" : "border-rule bg-surface hover:bg-surface2"}`}
            >
              <div className="text-[10.5px] text-steel leading-tight">
                {g.label}
              </div>
              <div className="font-display text-[22px] font-bold tabular-nums mt-1">
                {g.key === "NO_ENCONTRADA" && data && !data.firstSyncDone
                  ? "—"
                  : n.toLocaleString("es-EC")}
              </div>
              {g.key === "NO_ENCONTRADA" && data && !data.firstSyncDone && (
                <div className="text-[10px] text-steel">
                  al terminar la 1.ª actualización
                </div>
              )}
              {g.key !== "NO_ENCONTRADA" && totalAll > 0 && (
                <div className="text-[10px] text-steel">
                  {Math.round((n / totalAll) * 100)}%
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3 text-[12px]">
        <select
          value={account}
          onChange={(e) => setFilter(() => setAccount(e.target.value))}
          className="bg-surface border border-rule rounded px-2 py-1.5"
        >
          <option value="">Todas las cuentas</option>
          {data?.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          value={carrier}
          onChange={(e) => setFilter(() => setCarrier(e.target.value))}
          className="bg-surface border border-rule rounded px-2 py-1.5"
        >
          <option value="">Todas las transportadoras</option>
          {data?.carriers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-steel">
          Día del corte
          <input
            type="date"
            value={day}
            onChange={(e) => setFilter(() => setDay(e.target.value))}
            className="bg-surface border border-rule rounded px-2 py-1 text-ink"
          />
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFilter(() => setQ(qInput.trim()));
          }}
          className="flex items-center gap-1"
        >
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Buscar guía u orden"
            className="bg-surface border border-rule rounded px-2 py-1.5 w-[170px]"
          />
          <button
            type="submit"
            className="p-1.5 border border-rule rounded cursor-pointer"
            aria-label="Buscar"
          >
            <Search size={13} />
          </button>
        </form>
        {(group || attention || account || carrier || day || q) && (
          <button
            type="button"
            onClick={() =>
              setFilter(() => {
                setGroup("");
                setAttention("");
                setAccount("");
                setCarrier("");
                setDay("");
                setQ("");
                setQInput("");
              })
            }
            className="text-blue underline cursor-pointer"
          >
            Quitar filtros
          </button>
        )}
      </div>

      <div className="bg-surface border border-rule rounded-lg overflow-x-auto">
        {loading && !data ? (
          <div className="p-5 text-[12px] text-steel">Cargando guías…</div>
        ) : !data || data.rows.length === 0 ? (
          <div className="p-5 text-[12px] text-steel">
            {attention
              ? "Nada en esta lista por ahora."
              : group === "NO_ENCONTRADA" && !data?.firstSyncDone
                ? "Se calcula cuando las 3 cuentas terminen su primera actualización."
                : group === "NO_ENCONTRADA"
                  ? "Todas las guías de los cortes aparecen en Dropi."
                  : "No hay guías con estos filtros. Si es la primera vez, pulsa Actualizar ahora."}
          </div>
        ) : (
          <table
            className={`w-full text-[12px] ${loading ? "opacity-60" : ""}`}
          >
            <thead>
              <tr className="text-left text-steel font-mono text-[10px] uppercase tracking-wide">
                <th className="py-2 px-3">Guía</th>
                <th className="py-2 pr-3">Orden Dropi</th>
                <th className="py-2 pr-3">Cuenta</th>
                <th className="py-2 pr-3">Transportadora</th>
                <th className="py-2 pr-3">Ciudad</th>
                <th className="py-2 pr-3">Grupo</th>
                <th className="py-2 pr-3">Estado en Dropi</th>
                <th className="py-2 pr-3">En este estado</th>
                <th className="py-2 pr-3">Corte</th>
                <th className="py-2 pr-3">Días</th>
                {attention && <th className="py-2 pr-3">Motivo</th>}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((g) => {
                const meta = GROUP_BY_KEY.get(g.statusGroup ?? "");
                const d = daysSince(g.manifestDay);
                return (
                  <tr key={g.guideNumber} className="border-t border-rule">
                    <td className="py-1.5 px-3 font-mono whitespace-nowrap">
                      {g.guideNumber}
                      {g.rateType?.toUpperCase() === "SIN RECAUDO" && (
                        <span
                          className="ml-1.5 font-sans text-[9.5px] font-semibold rounded bg-teal/15 text-teal px-1.5 py-0.5"
                          title="Sin recaudo: puede ser una garantía"
                        >
                          SIN RECAUDO
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 font-mono">
                      {g.dropiOrderId ?? "—"}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {g.account ?? "—"}
                    </td>
                    <td className="py-1.5 pr-3">{g.carrier ?? "—"}</td>
                    <td className="py-1.5 pr-3">{g.city ?? "—"}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {meta && (
                        <span
                          className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${meta.cls}`}
                        >
                          {meta.label}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3">
                      {g.status ?? "—"}
                      {g.status && /INDEMNIZ/i.test(g.status) && (
                        <span className="ml-1.5 text-[9.5px] font-semibold rounded bg-gold/20 text-gold px-1.5 py-0.5">
                          INDEMNIZADA
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {sinceLabel(g.statusSince)}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {g.manifestDay ?? "—"}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">{d ?? "—"}</td>
                    {attention && (
                      <td className="py-1.5 pr-3 text-amber">
                        {g.reason ?? "—"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between mt-2 text-[12px] text-steel">
          <span>
            {data.total.toLocaleString("es-EC")} guías · página {data.page} de{" "}
            {pages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => (setLoading(true), setPage((p) => p - 1))}
              className="border border-rule rounded px-2.5 py-1 cursor-pointer disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => (setLoading(true), setPage((p) => p + 1))}
              className="border border-rule rounded px-2.5 py-1 cursor-pointer disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
      <div className="text-[10.5px] text-steel mt-2">
        &quot;En este estado&quot; cuenta desde que NICK vio el cambio (— = ya
        estaba así cuando NICK la leyó por primera vez). &quot;Días&quot; = días
        desde el corte. Las guías de Rocket no se buscan en Dropi.
      </div>
    </div>
  );
}
