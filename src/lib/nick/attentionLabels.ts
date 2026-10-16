// Nombres de las 5 listas de "Requiere atención" de NICK (sin base de datos:
// lo usa también la pantalla en el navegador). Ver attention.ts.
export type NickAttentionKey = "ESTANCADA" | "NOVEDAD_ABIERTA" | "DEVOLUCION_NO_LLEGO" | "CANCELADA_TRAS_SALIR" | "INDEMNIZADA";

export const NICK_ATTENTION: { key: NickAttentionKey; label: string; hint: string }[] = [
  { key: "ESTANCADA", label: "Estancadas", hint: "En camino sin ningún cambio en Dropi por 3 días laborables" },
  { key: "NOVEDAD_ABIERTA", label: "Novedad sin resolver", hint: "Con novedad hace más de 1 día laborable" },
  { key: "DEVOLUCION_NO_LLEGO", label: "Devolución que no llegó a bodega", hint: "Devolución hace 5+ días laborables y la guía no se escaneó en Reingresos" },
  { key: "CANCELADA_TRAS_SALIR", label: "Cancelada después de salir", hint: "Cancelada o anulada en Dropi, pero salió en un corte y no está retenida ni reportada" },
  { key: "INDEMNIZADA", label: "Indemnizada por Dropi", hint: "Dropi la marcó INDEMNIZADA" },
];
