"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, RefreshCw, Unplug, ShieldCheck } from "lucide-react";
import type { NickAccountView } from "@/lib/nick/accounts";
import type { NickReadResult } from "@/lib/nick/dropiMcp";
import { formatDateTime } from "@/lib/formatDateTime";

// NICK — Etapa 0 (2026-10-15): conectar las 3 cuentas de Dropi con el
// conector oficial y ver las últimas guías tal como las ve Dropi. Solo
// lectura: no cambia guías de DAFLOW, no crea pedidos, no muestra dinero.

const NOTICES: Record<string, string> = {
  cancelado: "Se canceló la entrada en Dropi. La cuenta sigue sin conectar.",
  vencido: "Pasaron más de 15 minutos o se abrió desde otra sesión. Vuelve a pulsar Conectar.",
  permiso: "No tienes acceso a NICK.",
  permiso_dropi: "Dropi no entregó el permiso. Vuelve a intentarlo; si se repite, avísale al administrador.",
  registro: "Dropi no aceptó registrar a DAFLOW en este momento. Intenta de nuevo en unos minutos.",
};

function StatusBadge({ status }: { status: NickAccountView["status"] }) {
  const map = {
    conectada: { label: "Conectada", cls: "bg-green/15 text-green" },
    sin_conectar: { label: "Sin conectar", cls: "bg-steel/15 text-steel" },
    por_reconectar: { label: "Por reconectar", cls: "bg-amber/20 text-amber" },
  } as const;
  const s = map[status];
  return <span className={`font-mono text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${s.cls}`}>{s.label}</span>;
}

export function NickPanel({
  accounts,
  isAdmin = false,
  notice,
}: {
  accounts: NickAccountView[];
  isAdmin?: boolean;
  notice?: { ok?: string; error?: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [reads, setReads] = useState<Record<string, NickReadResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const okName = notice?.ok ? accounts.find((a) => a.id === notice.ok)?.name : null;

  const read = async (id: string) => {
    setBusy(`read:${id}`);
    setErrors((e) => ({ ...e, [id]: "" }));
    const res = await fetch(`/api/nick/dropi/${id}/read`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setReads((r) => ({ ...r, [id]: data as NickReadResult }));
    else {
      setErrors((e) => ({ ...e, [id]: data.error ?? "No se pudo leer Dropi." }));
      if (data.reconnect) router.refresh();
    }
    setBusy(null);
  };

  const disconnect = async (a: NickAccountView) => {
    if (!confirm(`¿Desconectar ${a.name}? DAFLOW dejará de leer esa cuenta hasta que se vuelva a conectar.`)) return;
    setBusy(`off:${a.id}`);
    await fetch(`/api/nick/dropi/${a.id}/disconnect`, { method: "POST" });
    setReads((r) => {
      const next = { ...r };
      delete next[a.id];
      return next;
    });
    setBusy(null);
    router.refresh();
  };

  return (
    <div className="max-w-[1100px]">
      {okName && (
        <div className="mb-4 rounded-lg border border-green/40 bg-green/10 px-4 py-3 text-[12.5px]">
          <b>{okName}</b> quedó conectada. Pulsa <b>Leer ahora</b> para ver sus últimas guías.
        </div>
      )}
      {notice?.error && (
        <div className="mb-4 rounded-lg border border-red/40 bg-red/10 px-4 py-3 text-[12.5px]">{NOTICES[notice.error] ?? "Algo salió mal al conectar."}</div>
      )}

      <div className="bg-surface border border-rule rounded-lg p-4 mb-5 flex gap-3 text-[12px] text-steel">
        <ShieldCheck size={18} className="shrink-0 text-teal mt-0.5" />
        <div>
          Al pulsar <b className="text-ink">Conectar</b> se abre la ventana <b className="text-ink">oficial de Dropi</b> (oauth.dropi.co). Ahí se escriben el
          usuario, la clave y el código 2FA de esa cuenta — <b className="text-ink">DAFLOW nunca ve ni guarda la clave</b>. Dropi solo le da a DAFLOW un permiso
          de lectura que no puede ver la billetera ni mover dinero. Si la dirección no dice <b className="text-ink">oauth.dropi.co</b>, no escribas nada.
        </div>
      </div>

      <div className="font-mono text-[10.5px] tracking-[.14em] uppercase text-steel mb-2">Cuentas de Dropi</div>
      <div className="flex flex-col gap-4">
        {accounts.map((a) => {
          const r = reads[a.id];
          return (
            <div key={a.id} className="bg-surface border border-rule rounded-lg p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-display text-[16px] font-bold">{a.name}</span>
                    <StatusBadge status={a.status} />
                  </div>
                  <div className="text-[11px] text-steel mt-1">
                    {a.connectedAt
                      ? `Conectada por ${a.connectedByName} el ${formatDateTime(a.connectedAt)}`
                      : "Todavía nadie la conectó."}
                    {a.lastReadAt && ` · Última lectura: ${formatDateTime(a.lastReadAt)}`}
                  </div>
                  {a.dropiIdentity && <div className="text-[11px] text-steel mt-0.5">Dropi dice: {a.dropiIdentity}</div>}
                  {a.status === "por_reconectar" && a.lastError && <div className="text-[11.5px] text-amber mt-1">{a.lastError}</div>}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {a.status === "conectada" && (
                    <button
                      type="button"
                      onClick={() => read(a.id)}
                      disabled={!!busy}
                      className="inline-flex items-center gap-1.5 rounded-md bg-blue text-white px-3 py-1.5 text-[12.5px] font-semibold cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw size={13} className={busy === `read:${a.id}` ? "animate-spin" : ""} /> Leer ahora
                    </button>
                  )}
                  {a.status !== "conectada" && (
                    <a
                      href={`/api/nick/dropi/connect?account=${encodeURIComponent(a.id)}`}
                      className="inline-flex items-center gap-1.5 rounded-md bg-teal text-white px-3 py-1.5 text-[12.5px] font-semibold"
                    >
                      <Link2 size={13} /> {a.status === "por_reconectar" ? "Volver a conectar" : "Conectar"}
                    </a>
                  )}
                  {a.status !== "sin_conectar" && (
                    <button
                      type="button"
                      onClick={() => disconnect(a)}
                      disabled={!!busy}
                      className="inline-flex items-center gap-1.5 rounded-md border border-rule px-3 py-1.5 text-[12.5px] text-steel cursor-pointer disabled:opacity-50"
                    >
                      <Unplug size={13} /> Desconectar
                    </button>
                  )}
                </div>
              </div>

              {errors[a.id] && <div className="mt-3 text-[12px] text-red">{errors[a.id]}</div>}

              {r && (
                <div className="mt-4 border-t border-rule pt-3">
                  <div className="text-[13px] font-semibold mb-1">Últimas guías en Dropi</div>
                  <div className="text-[11px] text-steel mb-2">
                    Así las ve Dropi ahora mismo. Es una prueba: no cambia nada en DAFLOW y no muestra montos.
                  </div>
                  {r.note && <div className="text-[12px] text-amber mb-2">{r.note}</div>}
                  {r.rows.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="text-left text-steel font-mono text-[10px] uppercase tracking-wide">
                            <th className="py-1.5 pr-3">Orden</th>
                            <th className="py-1.5 pr-3">Guía</th>
                            <th className="py-1.5 pr-3">Estado</th>
                            <th className="py-1.5 pr-3">Transportadora</th>
                            <th className="py-1.5 pr-3">Ciudad</th>
                            <th className="py-1.5 pr-3">Fecha</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.rows.map((g, i) => (
                            <tr key={`${g.orderId ?? ""}-${i}`} className="border-t border-rule">
                              <td className="py-1.5 pr-3 font-mono">{g.orderId ?? "—"}</td>
                              <td className="py-1.5 pr-3 font-mono">{g.guide ?? "—"}</td>
                              <td className="py-1.5 pr-3 font-semibold">{g.status ?? "—"}</td>
                              <td className="py-1.5 pr-3">{g.carrier ?? "—"}</td>
                              <td className="py-1.5 pr-3">{g.city ?? "—"}</td>
                              <td className="py-1.5 pr-3 whitespace-nowrap">{g.date ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {isAdmin && (
                    <details className="mt-3 text-[11px] text-steel">
                      <summary className="cursor-pointer">Qué ofrece Dropi en esta cuenta (solo lo ves tú)</summary>
                      <div className="mt-2">
                        <b>Herramientas:</b> {r.tools.join(", ") || "ninguna"}
                      </div>
                      <div className="mt-1">
                        <b>Usada para listar:</b> {r.orderTool ?? "ninguna"}
                      </div>
                      {r.fields.length > 0 && (
                        <div className="mt-1 break-words">
                          <b>Datos de cada orden en la lista (sin montos):</b> {r.fields.join(", ")}
                        </div>
                      )}
                      <div className="mt-1">
                        <b>Usada para el detalle:</b> {r.detailTool ?? "ninguna"}
                      </div>
                      {r.detailFields.length > 0 && (
                        <div className="mt-1 break-words">
                          <b>Datos del detalle de una orden (sin montos):</b> {r.detailFields.join(", ")}
                        </div>
                      )}
                      <div className="mt-3 border-t border-rule pt-2">
                        <b>Diagnóstico</b>
                        <div className="mt-1">
                          <b>La lista acepta:</b> {r.diag.listArgs.join(", ") || "nada (sin filtros)"}
                        </div>
                        <div className="mt-1">
                          <b>El detalle pide:</b> {r.diag.detailArgs.join(", ") || "—"}
                          {r.diag.detailIdUsed && <> · se probó con {r.diag.detailIdUsed}</>}
                        </div>
                        {r.diag.detailResult && (
                          <div className="mt-1 break-words">
                            <b>Resultado del detalle:</b> {r.diag.detailResult}
                          </div>
                        )}
                        {r.diag.detailKeysSeen.length > 0 && (
                          <div className="mt-1 break-words">
                            <b>Claves que trae el detalle:</b> {r.diag.detailKeysSeen.join(", ")}
                          </div>
                        )}
                        {r.diag.statuses && (
                          <div className="mt-1">
                            <b>Estados que existen en Dropi:</b>
                            <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[10.5px] bg-cloud rounded p-2 max-h-[220px] overflow-y-auto">
                              {r.diag.statuses}
                            </pre>
                          </div>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
