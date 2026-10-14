import { COLD_MAX, COLD_SOON_DAYS, COLD_WEEK_AHEAD_DAYS, COVER_DAYS_AFTER_ARRIVAL, DISCARD_VALID_DAYS, ESCALATE_DAYS, COLD_ESCALATE_DAYS, HOT_DAYS, HOT_SALES_WINDOW_DAYS, SUPPLIER_RECHECK_DAYS, URGENT_DAYS, URGENT_DAYS_CREDIT_SUPPLIER } from "@/lib/purchaseSuggestions";

// "¿Qué significa?" (pedido del usuario 2026-10-14, Nairoby no entendía una
// fila de Qué comprar): Mary explica en palabras sencillas lo que la persona
// ya ve en pantalla. El navegador manda solo el texto visible del bloque; las
// reglas de cómo se calcula cada cifra viven aquí en el servidor para que
// Mary no las adivine. Para agregar el botón a otra pantalla: una entrada
// nueva aquí + <ExplainButton topic="..."> en esa pantalla.
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
} as const;

export type ExplainTopic = keyof typeof EXPLAIN_TOPICS;
export const EXPLAIN_TOPIC_KEYS = Object.keys(EXPLAIN_TOPICS) as [ExplainTopic, ...ExplainTopic[]];

export const EXPLAIN_SYSTEM_PROMPT = `Eres Mary, la asistente de DAFLOW para Provedix (Guayaquil, Ecuador). Tono femenino, cercano y directo. Aquí la persona tocó "¿Qué significa?" sobre un bloque de su pantalla y necesita entender qué le está diciendo y qué tiene que hacer.
- Explica como a alguien que nunca ha visto la pantalla: frases cortas, palabras de todos los días, nada técnico.
- Usa los números y nombres que aparecen en el texto de la pantalla para explicar con ese mismo caso ("te quedan 2, se venden unas 4 por semana, entonces te duran 3 días…").
- Usa SOLO las reglas de la pantalla que te paso y lo que se ve en el texto. Nunca inventes cifras, botones ni reglas. Si algo no está claro, dilo con honestidad y sugiere preguntarle a su líder.
- Sé breve: la primera respuesta en máximo 120 palabras. 1) Qué significa, en 3 o 4 líneas. 2) "Qué hacer:" con la acción concreta (qué botón tocar), una línea por opción. Nada de saludos largos ni detalles que no pregunte.
- No tomes decisiones de negocio por la persona: explica las opciones y qué pasa con cada una.
- Escribe en texto plano: nada de asteriscos, almohadillas ni otros símbolos de formato. Puedes usar guiones para listas.
- Si después pregunta algo que no tiene que ver con esta pantalla, dile con amabilidad que para eso puede usar el chat de Mary.
- Responde siempre en español.`;
