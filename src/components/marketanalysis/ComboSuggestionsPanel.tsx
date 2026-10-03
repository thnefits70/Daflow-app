"use client";

import { ComboSuggestionsBoard } from "@/components/marketanalysis/ComboSuggestionsBoard";
import { TabGuide } from "@/components/shared/TabGuide";

// Pantalla de "Sugerencias de Combos". Pedido del usuario 2026-10-01: ya no
// hay sub-pestañas para pegar ATOM ni anotar la baja rotación semanal a mano
// — los ganadores y lo que casi no se mueve salen solos de los cortes (ver
// comboSuggestions.ts). Los datos que se cargaron antes quedan guardados.
// canSyncAtom = equipo de Análisis de Mercado (nombre histórico del permiso).
export function ComboSuggestionsPanel({
  canSyncAtom,
  canApprove,
  canAct,
  canMarkCreated,
}: {
  canSyncAtom: boolean;
  canUploadLowRotation?: boolean;
  canApprove: boolean;
  canAct: boolean;
  canMarkCreated: boolean;
}) {
  if (!canSyncAtom && !canApprove) return null;
  return (
    <div>
      <TabGuide storageKey="combos-sugerencias">
        {canAct ? (
          <>Cada lunes el sistema arma solo los combos con lo que sale en los cortes: 1 ganador + 1 de baja salida, o 2 ganadores + 1 que casi no se mueve, siempre del mismo nicho, con nombre, precio Dropi (20% de margen) y stock recomendado. La asesora B2B elige cuáles te manda. Tú apruebas o rechazas cada uno y eliges UNA marca — un combo nunca se repite en otra marca.</>
        ) : canMarkCreated ? (
          <>Cada lunes el sistema arma solo los combos con nombre, precio Dropi, stock recomendado y por qué puede ganar. La lista queda toda la semana: elige cuáles mandar a aprobación según tu análisis (no hay que cambiar nada); lo que no mandes sale de la lista el lunes siguiente. Cuando el líder los apruebe, copia nombre, precio y stock a Dropi en la marca indicada, pega el ID que te dio Dropi y presiona &quot;Creado en Dropi&quot; — queda solo en Stock Actual y pasa a brandeo.</>
        ) : (
          <>Acá ves los combos que el sistema arma solo cada lunes. La asesora B2B elige cuáles mandar a aprobación; el líder de Análisis de Mercado aprueba cada uno y elige la marca.</>
        )}
      </TabGuide>
      <ComboSuggestionsBoard canApprove={canApprove} canAct={canAct} canMarkCreated={canMarkCreated} />
    </div>
  );
}
