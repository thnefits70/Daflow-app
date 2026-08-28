"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/formatDateTime";

type Grant = { id: string; type: "ADICIONAL" | "PRODUCTIVIDAD" | "MERITO"; note: string | null; grantedAt: string; user: { name: string } };

const LABELS: Record<Grant["type"], string> = { ADICIONAL: "Bono Adicional", PRODUCTIVIDAD: "Bono de Productividad", MERITO: "Bono al Mérito" };
// Mismo motivo por el que LABELS está duplicado acá en vez de importarse de
// commissionTiers.ts: ese archivo importa prisma (server-only) y este es un
// componente "use client" — no se puede traer al bundle del navegador.
const AMOUNTS: Record<Grant["type"], number> = { ADICIONAL: 50, PRODUCTIVIDAD: 100, MERITO: 150 };

// Confirmado 2026-08-14: solo lectura — Nairoby ve qué bonos otorgó el CEO
// para saber que ya vienen incluidos en la próxima quincena. Nunca visible
// a nadie más.
export function CeoBonusesForNairobyPanel() {
  const [grants, setGrants] = useState<Grant[] | null>(null);

  useEffect(() => {
    fetch("/api/ceo-bonuses/for-nairoby").then((r) => (r.ok ? r.json() : [])).then(setGrants);
  }, []);

  if (!grants || grants.length === 0) return null;

  return (
    <div className="bg-surface border border-rule rounded-md p-4 mb-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Bonos del CEO (confidencial)</div>
      <div className="flex flex-col gap-1.5">
        {grants.map((g) => (
          <div key={g.id} className="flex items-center justify-between gap-2 text-[12px] text-ink">
            <span><span className="font-semibold">{g.user.name}</span> — {LABELS[g.type]} · ${AMOUNTS[g.type]}</span>
            <span className="text-steel-dim shrink-0">{formatDateTime(g.grantedAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
