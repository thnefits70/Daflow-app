// Notas del desglose por día de "Pedidos despachados" (2026-10-15). Las lee
// la pantalla (DispatchedOrdersTrend) y también Mary (explainTopics →
// mapa de maryHelp), así lo que se agrega aquí lo aprende Mary sola — Daniel
// le preguntó por la flechita ↪ y Mary no sabía qué era. Sin imports: lo usa
// el navegador.
export const CARRIER_DEPARTURES =
  "Veloces 11:00, Urbano 13:00, Gintracom 15:00, Laar y Servientrega 17:00; sábado Veloces 10:30, Gintracom 11:00, Servientrega 12:00, Urbano y Laar no vienen";

export const DISPATCHED_NOTES = {
  brands: "Las columnas por marca son las guías que salen ese día.",
  outOfStockShownOnly:
    "Falta de stock: solo se muestra, no se resta — mientras no termine el inventario, el stock del sistema no es confiable para saber qué guías no salieron.",
  movedIn: `↪ Guías de un corte subido el día anterior cuando su transportadora ya se había ido (${CARRIER_DEPARTURES}): salen este día y cuentan aquí.`,
  warranties: "Garantías: guías del corte que son garantías — salen, pero no son pedidos, así que no cuentan.",
  retained: "guías canceladas que Daniel o Allan confirmaron que retuvieron — no salieron, no cuentan.",
  cancelled:
    "guías de los cortes de ese día que después se reportaron como canceladas — siguen sumando en despachados hasta que se confirme que se retuvieron. Entre paréntesis, las reportadas ese día en total (algunas pueden ser de otros días o de guías que no estaban en un corte).",
} as const;

// Lo mismo, como lo lee Mary.
export const DISPATCHED_RULES = `PEDIDOS DESPACHADOS: gráfico semanal (en Inicio y en Mi área de trabajo → Pedidos despachados) con cuántos pedidos salieron cada semana; meta 6.000 por semana (unos 1.000 por día, lunes a sábado). La semana actual se actualiza sola cada vez que un corte se envía a Inventario, no es un número cerrado. Al hacer clic en una semana se abre el desglose por día.
DESGLOSE POR DÍA (columnas):
- ${DISPATCHED_NOTES.brands}
- Guías: total de guías que salen ese día. Si al lado sale un número entre paréntesis con la flechita, por ejemplo (3↪), son guías que vienen del día anterior. ${DISPATCHED_NOTES.movedIn} Ejemplo: un corte de Veloces subido el lunes a las 11:30 ya no alcanzó a salir el lunes, así que esas guías cuentan el martes; lo de Urbano o Laar subido el sábado pasa al lunes. Solo se mueve si el corte se subió ese mismo día; esto se cuenta así desde la semana 42 (lunes 12 de octubre de 2026), antes no aparece la flechita.
- − ${DISPATCHED_NOTES.warranties}
- − Retenidas: ${DISPATCHED_NOTES.retained}
- Falta de stock: si dice "− Falta de stock" se resta; si dice "Falta de stock*" (en gris) ${DISPATCHED_NOTES.outOfStockShownOnly.replace("Falta de stock: ", "")}
- + Ventas externas: ventas externas entregadas ese día (suman).
- = Despachados: guías − garantías − retenidas (− falta de stock si se resta) + ventas externas.
- Canceladas: ${DISPATCHED_NOTES.cancelled}`;
