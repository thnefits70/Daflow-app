"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { AtomSyncPanel } from "@/components/marketanalysis/AtomSyncPanel";
import { LowRotationWeeklyPanel } from "@/components/marketanalysis/LowRotationWeeklyPanel";
import { ComboSuggestionsBoard } from "@/components/marketanalysis/ComboSuggestionsBoard";

function todayIsoDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Confirmado 2026-08-31: pantalla de "Sugerencias de Combos" (ATOM + baja
// rotación) — ver memoria project_atom_combo_suggestions_idea para todo el
// diseño acordado. Tres sub-pestañas según el rol de quien la ve.
export function ComboSuggestionsPanel({
  canSyncAtom,
  canUploadLowRotation,
  canApprove,
}: {
  canSyncAtom: boolean;
  canUploadLowRotation: boolean;
  canApprove: boolean;
}) {
  const subTabs = [
    ...(canSyncAtom ? [{ key: "atom" as const, label: "Actualizar ATOM" }] : []),
    ...(canUploadLowRotation ? [{ key: "rotacion" as const, label: "Baja rotación semanal" }] : []),
    ...(canSyncAtom || canApprove ? [{ key: "sugerencias" as const, label: "Sugerencias" }] : []),
  ];
  const [sub, setSub] = useState(subTabs[0]?.key ?? "sugerencias");
  const [stale, setStale] = useState<{ dueToday: boolean; lastSyncAt: string | null } | null>(null);

  useEffect(() => {
    if (!canSyncAtom) return;
    fetch("/api/atom-sync/status")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStale)
      .catch(() => null);
  }, [canSyncAtom]);

  return (
    <div>
      {stale?.dueToday && (
        <div className="flex items-center gap-2 bg-gold/10 border border-gold/40 rounded-md px-3.5 py-2.5 mb-4 text-[12.5px]" style={{ color: "#D9A441" }}>
          <AlertTriangle size={15} className="shrink-0" />
          Hoy toca leer ATOM y todavía no se registró ninguna lectura — entra a ATOM y pega la tabla en "Actualizar ATOM".
        </div>
      )}

      {subTabs.length > 1 && (
        <div className="flex gap-4 border-b border-rule mb-4">
          {subTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`pb-2 text-[12.5px] font-semibold border-b-2 cursor-pointer ${
                sub === t.key ? "text-ink border-teal" : "text-steel border-transparent hover:text-ink"
              }`}
              onClick={() => setSub(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {sub === "atom" && canSyncAtom && <AtomSyncPanel />}
      {sub === "rotacion" && canUploadLowRotation && <LowRotationWeeklyPanel defaultWeekOf={todayIsoDate()} />}
      {sub === "sugerencias" && (canSyncAtom || canApprove) && <ComboSuggestionsBoard canApprove={canApprove} />}
    </div>
  );
}
