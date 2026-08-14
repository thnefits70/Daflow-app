"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

type Grant = { id: string; type: "ADICIONAL" | "PRODUCTIVIDAD" | "MERITO"; note: string | null; grantedAt: string };

const LABELS: Record<Grant["type"], string> = { ADICIONAL: "Bono Adicional", PRODUCTIVIDAD: "Bono de Productividad", MERITO: "Bono al Mérito" };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-EC", { day: "numeric", month: "long", year: "numeric" });
}

// Confirmado 2026-08-14: historial privado — solo la propia persona ve
// esto, para saber que un bono le corresponde cobrar en la próxima
// quincena (no aparece hasta que se publique el rol, pero acá ya lo sabe).
export function MyCeoBonusesPanel() {
  const [grants, setGrants] = useState<Grant[] | null>(null);

  useEffect(() => {
    fetch("/api/ceo-bonuses/mine").then((r) => (r.ok ? r.json() : [])).then(setGrants);
  }, []);

  if (!grants || grants.length === 0) return null;

  return (
    <div className="bg-surface border border-rule rounded-md p-4 mb-4.5">
      <div className="font-semibold text-[13.5px] mb-2 flex items-center gap-1.5">
        <Sparkles size={14} className="text-gold" style={{ color: "#D9A441" }} /> Mis bonos
      </div>
      <div className="flex flex-col gap-2">
        {grants.map((g) => (
          <div key={g.id} className="flex items-start justify-between gap-2 text-[12.5px] border-b border-rule last:border-0 pb-2 last:pb-0">
            <div>
              <div className="font-semibold">{LABELS[g.type]}</div>
              {g.note && <div className="text-steel text-[11.5px] mt-0.5">{g.note}</div>}
            </div>
            <div className="text-steel-dim text-[11px] shrink-0">{fmtDate(g.grantedAt)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
