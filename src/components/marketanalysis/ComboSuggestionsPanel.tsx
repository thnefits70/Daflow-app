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
  canAct,
  canMarkCreated,
}: {
  canSyncAtom: boolean;
  canUploadLowRotation: boolean;
  canApprove: boolean;
  canAct: boolean;
  canMarkCreated: boolean;
}) {
  // Pedido del usuario (2026-09-04): "Sugerencias" primero — es la pantalla
  // que se usa primero al entrar (revisar/enviar combos), no la de subir
  // datos — así también queda como pestaña por defecto.
  const subTabs = [
    ...(canSyncAtom || canApprove ? [{ key: "sugerencias" as const, label: "Sugerencias" }] : []),
    ...(canSyncAtom ? [{ key: "atom" as const, label: "Actualizar ATOM" }] : []),
    ...(canUploadLowRotation ? [{ key: "rotacion" as const, label: "Baja rotación semanal" }] : []),
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
        <div className="flex items-center gap-2 bg-gold/10 border border-gold/40 rounded-md px-3.5 py-2.5 mb-4 text-[12.5px]" style={{ color: "var(--color-gold)" }}>
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
            {canAct ? (
              <>Cada noche el sistema arma solo los combos con lo que sale en los cortes: 1 ganador + 1 de baja salida, o 2 ganadores + 1 que casi no se mueve, siempre del mismo nicho, con nombre, precio Dropi (20% de margen) y stock recomendado. La asesora B2B elige cuáles te manda. Tú apruebas o rechazas cada uno y eliges UNA marca — un combo nunca se repite en otra marca.</>
            ) : canMarkCreated ? (
              <>Cada noche el sistema arma solo los combos con nombre, precio Dropi y stock recomendado. Elige cuáles mandar a aprobación según tu análisis (no hay que cambiar nada). Cuando el líder los apruebe, copia nombre, precio y stock a Dropi en la marca indicada, pega el ID que te dio Dropi y presiona &quot;Creado en Dropi&quot; — queda solo en Stock Actual y pasa a brandeo.</>
            ) : (
              <>Acá ves los combos que el sistema arma solo cada noche. La asesora B2B elige cuáles mandar a aprobación; el líder de Análisis de Mercado aprueba cada uno y elige la marca.</>
            )}
          </TabGuide>
          <ComboSuggestionsBoard canApprove={canApprove} canAct={canAct} canMarkCreated={canMarkCreated} />
        </>
      )}
    </div>
  );
}
