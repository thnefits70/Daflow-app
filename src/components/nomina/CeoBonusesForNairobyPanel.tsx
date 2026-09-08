"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/formatDateTime";

type Grant = {
  id: string;
  type: "ADICIONAL" | "PRODUCTIVIDAD" | "MERITO";
  note: string | null;
  grantedAt: string;
  user: { name: string };
  targetPeriod: string;
  status: "PAID" | "INCLUDED" | "PENDING";
  paidAt: string | null;
};

const LABELS: Record<Grant["type"], string> = { ADICIONAL: "Bono Adicional", PRODUCTIVIDAD: "Bono de Productividad", MERITO: "Bono al Mérito" };
// Mismo motivo por el que LABELS está duplicado acá en vez de importarse de
// commissionTiers.ts: ese archivo importa prisma (server-only) y este es un
// componente "use client" — no se puede traer al bundle del navegador.
const AMOUNTS: Record<Grant["type"], number> = { ADICIONAL: 50, PRODUCTIVIDAD: 100, MERITO: 150 };
const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function periodLabel(period: string) {
  const [y, m, q] = period.split("-");
  const monthName = MONTHS[Number(m) - 1];
  return q === "Q1" ? `1-15 ${monthName} ${y}` : `16-fin ${monthName} ${y}`;
}

// Últimas 2 quincenas + próximas 3 — un bono se paga con un mes de desfase,
// así que la quincena destino suele caer en el futuro cercano, no en el
// pasado.
function periodOptions(): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = -1; i <= 2; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push(`${ym}-Q2`, `${ym}-Q1`);
  }
  return out.sort().reverse();
}

// Confirmado 2026-08-14: solo lectura — Nairoby ve qué bonos otorgó el CEO
// para saber que ya vienen incluidos en la próxima quincena. Nunca visible
// a nadie más. Ampliado 2026-09-08: pedido explícito del usuario — filtro
// por quincena de pago + estado (pagado / incluido en el rol / pendiente),
// para poder verificar qué bonos ya se pagaron o se van a pagar.
export function CeoBonusesForNairobyPanel() {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [period, setPeriod] = useState("");
  const options = periodOptions();

  useEffect(() => {
    const qs = period ? `?period=${period}` : "";
    fetch(`/api/ceo-bonuses/for-nairoby${qs}`).then((r) => (r.ok ? r.json() : [])).then(setGrants);
  }, [period]);

  if (grants === null) return null;
  if (grants.length === 0 && !period) return null;

  return (
    <div className="bg-surface border border-rule rounded-md p-4 mb-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel">Bonos del CEO (confidencial)</div>
        <select
          className="rounded border border-rule bg-cloud px-2 py-1 text-[11.5px]"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        >
          <option value="">Todas las quincenas</option>
          {options.map((p) => (
            <option key={p} value={p}>{periodLabel(p)}</option>
          ))}
        </select>
      </div>
      {grants.length === 0 && <div className="text-steel text-[12px]">No hay bonos que se paguen en esa quincena.</div>}
      <div className="flex flex-col gap-1.5">
        {grants.map((g) => (
          <div key={g.id} className="flex items-center justify-between gap-2 text-[12px] text-ink py-1 border-b border-rule last:border-0">
            <div className="flex flex-col gap-0.5">
              <span><span className="font-semibold">{g.user.name}</span> — {LABELS[g.type]} · ${AMOUNTS[g.type]}</span>
              <span className="text-steel-dim text-[11px]">Otorgado {formatDateTime(g.grantedAt)} · se paga en {periodLabel(g.targetPeriod)}</span>
            </div>
            {g.status === "PAID" && (
              <span className="text-[10.5px] font-semibold text-green bg-green/10 border border-green/30 rounded-full px-2 py-0.5 shrink-0">
                ✓ Pagado {g.paidAt ? formatDateTime(g.paidAt) : ""}
              </span>
            )}
            {g.status === "INCLUDED" && (
              <span className="text-[10.5px] font-semibold text-steel bg-cloud border border-rule rounded-full px-2 py-0.5 shrink-0">
                En el rol — falta pagar
              </span>
            )}
            {g.status === "PENDING" && (
              <span className="text-[10.5px] font-semibold bg-gold/10 border border-gold/35 rounded-full px-2 py-0.5 shrink-0" style={{ color: "#D9A441" }}>
                Pendiente
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
