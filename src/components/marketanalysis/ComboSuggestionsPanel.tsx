"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { AtomSyncPanel } from "@/components/marketanalysis/AtomSyncPanel";
import { LowRotationWeeklyPanel } from "@/components/marketanalysis/LowRotationWeeklyPanel";
import { ComboSuggestionsBoard } from "@/components/marketanalysis/ComboSuggestionsBoard";
import { TabGuide } from "@/components/shared/TabGuide";

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

      {sub === "atom" && canSyncAtom && (
        <>
          <TabGuide storageKey="combos-atom">
            Pega acá la tabla completa que copiaste de atomapp.com.co/productos (Ctrl+A). El sistema separa los productos marcados &quot;Rentable&quot; y los compara contra el catálogo — confirma o corrige cada uno y guarda. Esto alimenta las sugerencias de combos: entre más seguido lo actualices (lunes/miércoles/viernes), mejores sugerencias salen.
          </TabGuide>
          <AtomSyncPanel />
        </>
      )}
      {sub === "rotacion" && canUploadLowRotation && (
        <>
          <TabGuide storageKey="combos-rotacion">
            Cada semana, anota acá los productos que despacharon menos de 8 unidades — eso es lo que el sistema junta con los productos que sí se venden bien (de ATOM) para sugerir combos. El Excel de &quot;Productos sin movimiento&quot; que ya subes en KPIs de Inventario también suma solo, automáticamente — esto es para lo que quieras anotar a mano además de eso.
          </TabGuide>
          <LowRotationWeeklyPanel defaultWeekOf={todayIsoDate()} />
        </>
      )}
      {sub === "sugerencias" && (canSyncAtom || canApprove) && (
        <>
          <TabGuide storageKey="combos-sugerencias">
            {canApprove ? (
              <>Acá salen las combinaciones que la IA arma sola, cruzando productos que venden bien con productos de baja rotación — cada una trae un % de qué tan segura es. Marca las que quieras armar, mándalas a aprobación, y cuando las apruebes quedan listas para que alguien del equipo las cree en Dropi y marque &quot;Creado en Dropi&quot;. &quot;Descartar sin revisar&quot; borra las sugerencias viejas sin decisión tomada, y &quot;Recalcular sugerencias&quot; vuelve a correr el cruce con los datos más frescos (puede tardar hasta 1 minuto).</>
            ) : (
              <>Acá ves las combinaciones que la IA sugiere, cruzando productos que venden bien con productos de baja rotación — cada una trae un % de qué tan segura es. Seleccionar y mandar a aprobación es de cualquiera del equipo de Análisis de Mercado; aprobar o rechazar el lote es exclusivo del líder.</>
            )}
          </TabGuide>
          <ComboSuggestionsBoard canApprove={canApprove} />
        </>
      )}
    </div>
  );
}
