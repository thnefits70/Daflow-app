"use client";

import { useEffect, useRef, useState } from "react";
import type { CommissionProgress } from "@/lib/dashboard";

const TIER_EMOJI: Record<string, string> = { "Raíz": "🌱", "Cosecha": "🌾" };

const MONTH_ABBR = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function fmtMonth(month: string) {
  const [y, m] = month.split("-");
  return `${MONTH_ABBR[Number(m) - 1]} ${y.slice(2)}`;
}

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Confirmado 2026-08-14: pedido explícito del usuario — visible para TODO
// el equipo (no confidencial, a diferencia de los montos de comisión por
// persona/nivel) para el efecto motivacional buscado. Muestra el ÚLTIMO
// MES COMPLETO (nunca el mes en curso — pedido explícito, para que no se
// vea descuadrado contra "Pedidos despachados" que muestra la última
// semana sola) contra los 3 niveles. Sin rango de fechas visible (se sacó
// a pedido del usuario — el total siempre suma semanas completas, así que
// mostrar "6 jul – 1 ago" confundía aunque el cálculo fuera correcto).
//
// Confirmado 2026-09-10: al hacer clic en un bono se muestra cuánto
// ganaría ESE colaborador con ese nivel — para reforzar la motivación. El
// monto se trae de /api/commissions/my-amounts, que solo devuelve el monto
// del usuario logueado (nunca el de otra persona): los montos por persona
// siguen siendo confidenciales, esto no los expone al resto del equipo. El
// admin no tiene monto propio (no cobra esta comisión), así que su clic no
// muestra nada.
export function CommissionProgressCard({ progress }: { progress: CommissionProgress }) {
  const [openTierId, setOpenTierId] = useState<string | null>(null);
  const [myAmounts, setMyAmounts] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openTierId) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpenTierId(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openTierId]);

  if (!progress) return null;
  const { dailyAvg, month, tiers } = progress;

  async function handleToggle(tierId: string) {
    if (openTierId === tierId) {
      setOpenTierId(null);
      return;
    }
    setOpenTierId(tierId);
    if (myAmounts === null && !loading) {
      setLoading(true);
      try {
        const r = await fetch("/api/commissions/my-amounts");
        const data = r.ok ? await r.json() : { amounts: {} };
        setMyAmounts(data.amounts ?? {});
      } catch {
        setMyAmounts({});
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div ref={containerRef} className="bg-surface border border-rule rounded-lg p-5 mb-5">
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[10.5px] tracking-[.14em] uppercase text-steel">Comisión de equipo</div>
        {dailyAvg !== null && (
          <div className="text-right">
            <div className="text-[22px] font-extrabold tabular-nums leading-tight">{dailyAvg.toFixed(0)} pedidos/día</div>
            <div className="text-[11.5px] font-semibold text-steel-dim">{fmtMonth(month)} — mes pasado</div>
          </div>
        )}
      </div>
      {dailyAvg === null ? (
        <div className="text-steel text-[12.5px]">Todavía no hay datos de Pedidos despachados de {fmtMonth(month)}.</div>
      ) : (
        <div className="flex flex-wrap gap-2 items-start">
          {tiers.map((t) => {
            const achieved = dailyAvg >= t.minDailyAvg;
            const isProvedix = t.name === "PROVEDIX";
            const isOpen = openTierId === t.id;
            const myAmount = myAmounts?.[t.id];
            return (
              <div key={t.id} className="flex flex-col items-start">
                <button
                  type="button"
                  onClick={() => handleToggle(t.id)}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold border cursor-pointer ${
                    achieved ? "border-teal bg-teal/10 text-teal" : "border-rule text-steel"
                  } ${achieved && isProvedix ? "shadow-[0_0_10px_rgba(20,199,199,0.5)]" : ""} ${isOpen ? "ring-1 ring-teal" : ""}`}
                >
                  {TIER_EMOJI[t.name] && <span>{TIER_EMOJI[t.name]}</span>}
                  <span className={isProvedix ? "font-extrabold" : ""}>{t.name}</span>
                  <span className="text-steel-dim font-normal">{t.minDailyAvg}-{t.maxDailyAvg ?? "+"}</span>
                </button>
                {isOpen && (
                  <div className="mt-1 px-1 text-[11px] font-semibold text-steel-dim max-w-[180px]">
                    {loading ? (
                      "Cargando…"
                    ) : myAmount ? (
                      <>
                        Ganarías <span className="text-teal font-bold">{money(myAmount)}</span> con este nivel
                      </>
                    ) : (
                      "Tu monto para este nivel todavía no está configurado."
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
