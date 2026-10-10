"use client";

import { useB2BAdvisorLabel } from "@/lib/useB2BAdvisorLabel";

export const COMBO_BRAND_LABELS: Record<string, string> = {
  MKT_PROVEDIX: "Provedix",
  MKT_DAMIAN: "Importadora Damián",
  MKT_SHANGHAI: "Importadora Shanghai",
};

// Pedido del usuario 2026-10-10: la marca de un combo la decide el asesor que
// lo publica en Dropi, no quien registra la receta (Daniel). Si vino en el PDF
// de una marca, es esa (la cuenta donde se publicó); si vino en un PDF
// "SinMarca" (o solo en Rocket), la elige la asesora B2B desde su Inicio.
export function ComboBrandInfo({ brand }: { brand: string | null }) {
  const advisor = useB2BAdvisorLabel();
  const name = brand ? COMBO_BRAND_LABELS[brand] : null;
  return (
    <div className="text-[11px]">
      <span className="text-steel">Marca: </span>
      {name ? (
        <>
          <span className="font-semibold">{name}</span>
          <span className="text-steel"> — vino en el PDF de esa marca en Dropi.</span>
        </>
      ) : (
        <span className="text-gold">vino sin marca en Dropi — la elige {advisor.the} (le llega el pendiente).</span>
      )}
    </div>
  );
}
