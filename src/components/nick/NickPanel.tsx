"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Unplug, ShieldCheck } from "lucide-react";
import type { NickAccountView } from "@/lib/nick/accounts";
import { formatDateTime } from "@/lib/formatDateTime";
import { NickGuides } from "@/components/nick/NickGuides";
import { NickRankings } from "@/components/nick/NickRankings";
import { NickScore } from "@/components/nick/NickScore";
import { NickPayments } from "@/components/nick/NickPayments";

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
  // Etapa 4: pestaña Rankings, solo para el admin.
  const [view, setView] = useState<"guias" | "score" | "rankings" | "pagos">("guias");

  const okName = notice?.ok ? accounts.find((a) => a.id === notice.ok)?.name : null;

  const disconnect = async (a: NickAccountView) => {
    if (!confirm(`¿Desconectar ${a.name}? DAFLOW dejará de leer esa cuenta hasta que se vuelva a conectar.`)) return;
    setBusy(`off:${a.id}`);
    await fetch(`/api/nick/dropi/${a.id}/disconnect`, { method: "POST" });
    setBusy(null);
    router.refresh();
  };

  return (
    <div>
      {okName && (
        <div className="mb-4 rounded-lg border border-green/40 bg-green/10 px-4 py-3 text-[12.5px]">
          <b>{okName}</b> quedó conectada. NICK la va a leer sola en la próxima actualización (o pulsa <b>Actualizar ahora</b> arriba).
        </div>
      )}
      {notice?.error && (
        <div className="mb-4 rounded-lg border border-red/40 bg-red/10 px-4 py-3 text-[12.5px]">{NOTICES[notice.error] ?? "Algo salió mal al conectar."}</div>
      )}

      {isAdmin && (
        <div className="flex gap-2 mb-4">
          {([
            ["guias", "Guías"],
            ["score", "Score"],
            ["rankings", "Rankings"],
            ["pagos", "Pagos"],
          ] as const).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setView(k)}
              className={`rounded-md border px-3.5 py-1.5 text-[13px] cursor-pointer ${view === k ? "border-blue bg-blue/10 font-semibold" : "border-rule bg-surface"}`}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      {isAdmin && view === "pagos" ? (
        <NickPayments accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} />
      ) : isAdmin && view === "score" ? (
        <NickScore />
      ) : isAdmin && view === "rankings" ? (
        <NickRankings accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} />
      ) : (
        <NickGuides isAdmin={isAdmin} />
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-5">
        {accounts.map((a) => {
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
