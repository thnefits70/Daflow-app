// Preguntas frecuentes de provedix.com (pedido del usuario 2026-10-16). Las
// mismas respuestas van a la sección de la página y a la ficha para Google
// (FAQPage). Solo datos confirmados: cortes (PvxSections), garantías y forma
// de trabajar (reglas de Michelle IA), horario real de trabajo.

// Promesa de respuesta (pedido del usuario 2026-10-16): la asesora humana
// responde en menos de 3 horas, en horario de trabajo.
export const ADVISOR_RESPONSE_PROMISE = "menos de 3 horas";
export const WORK_HOURS_TEXT = "lunes a viernes de 8:30 a 17:00 y sábados de 8:30 a 12:30";

export const PVX_FAQ: { q: string; a: string }[] = [
  {
    q: "¿Cuánto cuesta usar Provedix?",
    a: "Nada. Ver los productos, sus ventas y la calculadora de ganancia es gratis. Para ver la ficha completa de un producto (precio al público, ciudades y combos) solo te registras una vez, gratis, con tu nombre y tu WhatsApp.",
  },
  {
    q: "¿Tengo que comprar stock o un mínimo?",
    a: "No. Eliges el producto, lo publicas en tu tienda o redes y, cuando un cliente te compra, creas el pedido en Dropi (o Rocket). Nosotros lo preparamos y lo despachamos desde nuestra bodega en Guayaquil, y el cliente paga contraentrega.",
  },
  {
    q: "¿Cómo empiezo a vender un producto?",
    a: "Busca un producto en el catálogo, copia su ID de Dropi (o su SKU de Rocket) y agrégalo a tu tienda. Usa nuestros creativos gratis para tus anuncios y la calculadora para saber a cuánto venderlo.",
  },
  {
    q: "¿A qué hora sale mi pedido?",
    a: "De lunes a viernes hacemos 3 cortes: guías a las 8:30, 11:00 y 14:00, y del corte a la transportadora en menos de 3 horas. Los sábados hay un solo corte, a las 8:30. Lo que se confirma después del último corte sale el siguiente día hábil.",
  },
  {
    q: "¿Con qué transportadoras trabajan?",
    a: "Servientrega, Gintracom, LaarCourier, Urbano y Veloces. Los sábados despachamos con Veloces, Servientrega y Gintracom.",
  },
  {
    q: "¿Cuánto voy a ganar por cada venta?",
    a: "Tu ganancia es lo que le cobras al cliente, menos el costo del producto en Dropi y menos el flete de ese pedido. La calculadora de esta página te dice el precio recomendado y cuánto puedes pagar de publicidad por venta.",
  },
  {
    q: "¿Qué hago si un producto llega incompleto, dañado o diferente?",
    a: "Pide la garantía a Michelle IA en esta misma página, dentro de las 48 horas de recibido el producto, con fotos o video (mejor al momento de la entrega). Si se aprueba, se registra en Dropi.",
  },
  {
    q: "¿En cuánto tiempo me responden?",
    a: `Michelle IA, nuestra asistente virtual, te responde al instante, a cualquier hora. Si tu caso necesita a una persona, Michelle, la asesora del equipo, te responde por WhatsApp en ${ADVISOR_RESPONSE_PROMISE} en horario de trabajo (${WORK_HOURS_TEXT}).`,
  },
];

// Política de privacidad (2026-10-16): provedix.com/privacidad (el proxy la
// lleva a /pvx/privacidad).
export const PRIVACY_URL = "/privacidad";
