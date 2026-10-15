import { COLD_MAX, COLD_SOON_DAYS, COLD_WEEK_AHEAD_DAYS, COVER_DAYS_AFTER_ARRIVAL, DISCARD_VALID_DAYS, ESCALATE_DAYS, COLD_ESCALATE_DAYS, HOT_DAYS, HOT_SALES_WINDOW_DAYS, SUPPLIER_RECHECK_DAYS, URGENT_DAYS, URGENT_DAYS_CREDIT_SUPPLIER } from "@/lib/purchaseSuggestions";
import { DISPATCHED_RULES } from "@/lib/dispatchedNotes";

// "¿Qué significa?" (pedido del usuario 2026-10-14, Nairoby no entendía una
// fila de Qué comprar): Mary explica en palabras sencillas lo que la persona
// ya ve en pantalla. El navegador manda solo el texto visible del bloque; las
// reglas de cómo se calcula cada cifra viven aquí en el servidor para que
// Mary no las adivine. Para agregar el botón a otra pantalla: una entrada
// nueva aquí + <ExplainButton topic="..."> en esa pantalla.
// 2026-10-15: estas mismas reglas van en el mapa del chat de Mary (ver
// maryHelp.ts), así lo que se explica aquí también lo sabe cuando le
// preguntan en el chat. Si una pantalla tiene notas propias, que salgan de
// un archivo compartido (como dispatchedNotes.ts) para no escribirlas dos
// veces.
const FILL_RATE_RULES = `FILL RATE (semanal): de todos los pedidos que había que despachar en la semana, qué porcentaje sí salió. Fill Rate = despachados ÷ (despachados + no despachados) × 100. "No despachados" son los que no salieron, por ejemplo por "Falta de stock" (no había la mercadería). Colores: 96% o más = Excelente (verde); 90 a 95% = Muy bueno (amarillo); menos de 90% = Alerta (rojo). Si baja de 95%, el Líder de Inventarios (Daniel) escribe una explicación para todo el equipo. "Manifiestos fuera de plazo": manifiestos que se subieron después del día que tocaba (no entran en el %). "Guías canceladas": guías de los cortes que se cancelaron, por motivo (no entran en el %).`;

export const EXPLAIN_TOPICS = {
  "que-comprar": {
    label: "Control de Compras → Qué comprar",
    rules: `Pantalla "Qué comprar": lista automática de productos que hay que volver a comprar antes de que se acaben.
- "Quedan X": unidades que hay en bodega ahora. "(contado)" = ese número salió del conteo físico, es real.
- "sale ~N por día / por semana": promedio de lo que se vendió (pedidos de Dropi + ventas externas; los combos cuentan como venta de cada producto). Compras frías usan los últimos 30 días; compras calientes, los últimos ${HOT_SALES_WINDOW_DAYS} días.
- "alcanza para N días": Quedan ÷ lo que sale por día. Es en cuántos días se queda sin stock si se sigue vendiendo igual.
- Jariel y Nairoby le compran a muchos proveedores. CHEN es solo uno de ellos; su ventaja es que nos da la mercadería a crédito (se paga después). Cada producto se mide con el proveedor al que se le compró la última vez (sale como "Última compra: ..."); si nunca se compró en DAFLOW, se cuentan 7 días.
- Tiempo que tarda el proveedor en traerlo: CHEN lo trae en máximo ${URGENT_DAYS_CREDIT_SUPPLIER} días; los demás proveedores tardan máximo 4 días hábiles (lunes a sábado medio día), por eso con ellos se cuentan ${URGENT_DAYS} días de calendario. Si la última compra fue a CHEN, el producto casi nunca sale como urgente en compras frías: cuando ya se acaba en ${HOT_DAYS} días pasa a compras calientes.
- Las cantidades son unidades (piezas) del producto.
- "Urgente": alcanza para ese tiempo o menos, o sea que si no se pide ya, se queda sin stock antes de que llegue lo nuevo. "Pronto": todavía alcanza para más tiempo del que tarda el proveedor.
- "Comprar ~N u. (para X días mientras llega + 1 mes)": cantidad sugerida = lo que se vende por día × (días que tarda el proveedor + ${COVER_DAYS_AFTER_ARRIVAL} días) − lo que queda. Es una guía, no una orden.
- Compras calientes: se acaban en ${HOT_DAYS} días o menos (las compra quien tenga la lista caliente). Compras frías: ${COLD_MAX} unidades o menos, o se acaban en ${COLD_SOON_DAYS} días, pero todavía alcanzan más de ${HOT_DAYS} días (lista semanal).
- "Comprar o descartar esta semana": en compras frías, es urgente o se vuelve urgente antes del próximo lunes (dentro de ${COLD_WEEK_AHEAD_DAYS} días más). Hay que decidir esta semana: comprarlo o marcar que no hace falta.
- "Urgente hace N días o más sin comprar — ya se avisó a Daniel": lleva ${ESCALATE_DAYS} días (calientes) o ${COLD_ESCALATE_DAYS} días (frías) en urgente sin que nadie lo compre.
- "Se acaba en ${COLD_SOON_DAYS} días o menos": compra fría que se está acabando; llega un aviso diario.
- "Nueva hoy": compra caliente que ayer todavía alcanzaba para más de ${HOT_DAYS} días.
- Franja verde a la izquierda: ya recontado, el stock es real. Amarilla: contado pero falta aplicarlo o está en recuento. Sin franja: todavía no se cuenta.
- "Falta contar": el sistema dice que hay ese stock, pero nadie lo ha contado; no se compra (salvo emergencia) hasta que lo cuenten.
- "Reparto por color/talla": cómo repartir la cantidad sugerida según lo que más se vende de cada variante.
Botones:
- "Analizar recompra": abre la calculadora de recompra con el producto ya elegido; ahí se arma la recompra (RC) que aprueba Bryan.
- "No hace falta comprarlo" (solo compras frías): lo saca de la lista con un motivo; vuelve solo a los ${DISCARD_VALID_DAYS} días, o antes si estaba en "pronto" y se pone urgente.
- "Ningún proveedor lo tiene": se reporta en Análisis de Mercado → Sin stock de proveedor; deja de avisar y cada ${SUPPLIER_RECHECK_DAYS} días pregunta si el proveedor ya lo tiene.
- "Pedir que lo cuenten": le aparece a Daniel en su Inicio para contarlo antes de comprar.`,
  },
  // Pedido del usuario 2026-10-14: también en KPIs (Inicio, KPIs Generales,
  // KPIs de Inventario), Fill Rate y Stock Actual.
  kpis: {
    label: "Indicadores (KPIs) de DAFLOW",
    rules: `Indicadores que se calculan solos con lo que se registra en DAFLOW.
${FILL_RATE_RULES}
TASA DE DEVOLUCIÓN (mensual): de cada 100 unidades que salieron en los cortes (sin contar garantías), cuántas regresaron (por Reingreso de mercadería, en buen estado o dañadas). Más bajo es mejor. Menos de 20% = Excelente; 21 a 27% = Muy bueno; 28% o más = Alerta. Las devoluciones tardan de 7 a 20 días en volver, por eso un mes se empieza a medir desde el día 15 y sale "Preliminar" hasta 20 días después de cerrar el mes. Se mide en unidades, por eso puede salir distinto de lo que dice ATOM (que cuenta pedidos). Por producto se marca ⚠️ desde 15% si tuvo al menos 10 salidas; con menos sale "pocas salidas" porque el % no sería confiable.
GARANTÍAS (mensual): cuando a un cliente le llega un producto dañado, roto, incompleto o equivocado y se le manda otro. Tasa = garantías ÷ guías de pedidos del mes. Motivos en dos grupos: "Falla del producto" (no funciona, roto) y "Error de bodega" (incompleto, diferente). Las garantías locales de Guayaquil (GL-…) suman a los motivos pero no al total del mes. "Pérdidas por garantías": dinero que no regresa (el producto nuevo que se mandó al costo + flete de enviar y de recoger).
KPIs DE INVENTARIO (mensuales, con el valor del inventario que carga Daniel):
- Días de inventario (DIO): cuántos días tomaría vender todo lo que hay guardado al ritmo actual. Más bajo es mejor (el dinero no se queda dormido).
- Inventario vs. ventas: compara si lo guardado crece al mismo ritmo que lo vendido. Si el inventario sube 2 meses seguidos y las ventas no, sale una alerta de que se está comprando más de lo que se vende.
- GMROI: por cada $1 que hay en inventario, cuánta ganancia bruta deja. 2x = $2 de ganancia por cada $1 (bueno); menos de 1x = gana menos de lo que tiene guardado. Por ahora se mira si sube o baja (todavía no hay meta fija).
- Productos sin movimiento: productos cuyo stock no bajó desde la semana anterior, o sea que no se vendieron. El % es cuánto del dinero en inventario está ahí parado (más de 15% se marca en rojo). Flechas: ↑ roja = el stock siguió subiendo; ↓ verde = empezó a moverse; — gris = no cambió.
Líneas de tendencia: cada punto es una semana o un mes; en rojo cuando pasa la zona de alerta.`,
  },
  // Pedido del usuario 2026-10-15: Daniel le preguntó a Mary por la ↪ del
  // desglose por día y no sabía qué era.
  "pedidos-despachados": {
    label: "Pedidos despachados (gráfico semanal y desglose por día)",
    rules: `${DISPATCHED_RULES}
${FILL_RATE_RULES}`,
  },
  "stock-actual": {
    label: "Stock Actual (INVESTOCK)",
    rules: `Pantalla "Stock Actual": cuánto hay de cada producto en bodega y a qué precio se vende en cada canal.
- "Stock INVESTOCK": unidades que hay según el Kardex de DAFLOW (lo que entró por Compras menos lo que salió por Egresos/cortes, más reingresos y ajustes). Se calcula solo, nadie sube un archivo.
- Número en rojo / negativo: salió más de lo que entró en el sistema. Casi siempre es un error de conteo o algo que salió sin registrarse su entrada; hay que revisarlo y contarlo.
- Franja verde a la izquierda: ya recontado en el conteo físico, el stock es real. Amarilla: contado pero falta que Daniel lo aplique, o tuvo una diferencia grande y otra persona lo vuelve a contar. Sin franja: todavía no se cuenta.
- "Aún no comprado": producto aprobado en Análisis de Mercado que nunca se compró (no es que se acabó). "ID … por liberar (Bryan)": tiene ID de Dropi esperando que Bryan lo libere. "Sin ID": falta ponerle el ID de Dropi.
- Variantes (color/talla): cuántas hay de cada una; "Sin identificar" = unidades que no se sabe de qué variante son.
- Combos: no tienen stock propio. El "≈" es cuántos combos se pueden armar con el stock real de sus productos.
- Columnas de COSTO: Proveedor (lo que cobra el proveedor, sin flete), Puesto en bodega (proveedor + flete; de aquí salen todos los precios), Benistock. Columnas de PRECIOS DE VENTA: B2B, Dropi, B2C 1 unidad, B2C 2 a 11 unidades. Cada columna tiene su botón ⓘ con la fórmula exacta (vienen en el texto si la persona los abrió).
- Botón de la flecha: unidades despachadas por día en los últimos 30 días.`,
  },
} as const;

export type ExplainTopic = keyof typeof EXPLAIN_TOPICS;
export const EXPLAIN_TOPIC_KEYS = Object.keys(EXPLAIN_TOPICS) as [ExplainTopic, ...ExplainTopic[]];

export const EXPLAIN_SYSTEM_PROMPT = `Eres Mary, la asistente de DAFLOW para Provedix (Guayaquil, Ecuador). Tono femenino, cercano y directo. Aquí la persona tocó "¿Qué significa?" sobre un bloque de su pantalla y necesita entender qué le está diciendo y qué tiene que hacer.
- Explica como a alguien que nunca ha visto la pantalla: frases cortas, palabras de todos los días, nada técnico.
- Usa los números y nombres que aparecen en el texto de la pantalla para explicar con ese mismo caso ("te quedan 2, se venden unas 4 por semana, entonces te duran 3 días…").
- Usa SOLO las reglas de la pantalla que te paso y lo que se ve en el texto. Nunca inventes cifras, botones ni reglas. Si algo no está claro, dilo con honestidad y sugiere preguntarle a su líder.
- Sé breve: la primera respuesta en máximo 120 palabras. 1) Qué significa, en 3 o 4 líneas. 2) Si es un indicador: si está bien o mal y por qué importa. 3) "Qué hacer:" con la acción concreta (qué botón tocar), una línea por opción, solo si hay algo que hacer. Nada de saludos largos ni detalles que no pregunte.
- No tomes decisiones de negocio por la persona: explica las opciones y qué pasa con cada una.
- Escribe en texto plano: nada de asteriscos, almohadillas ni otros símbolos de formato. Puedes usar guiones para listas.
- Si después pregunta algo que no tiene que ver con esta pantalla, dile con amabilidad que para eso puede usar el chat de Mary.
- Responde siempre en español.`;
