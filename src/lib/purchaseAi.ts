import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { prisma } from "@/lib/prisma";

const PURCHASE_AI_MODEL = "claude-sonnet-5";

async function fetchImageBase64(url: string): Promise<{ data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo leer la imagen de la cotización (${res.status}).`);
  const contentType = res.headers.get("content-type") ?? "";
  const mediaType = contentType.includes("png") ? "image/png" : contentType.includes("webp") ? "image/webp" : "image/jpeg";
  const buf = await res.arrayBuffer();
  return { data: Buffer.from(buf).toString("base64"), mediaType };
}

// Confirmado 2026-08-04: el comprobante de pago puede venir como foto O como
// PDF (a diferencia de la cotización, que siempre es foto) — se arma el
// bloque de contenido correcto según el tipo real del archivo en vez de
// mandar bytes de PDF disfrazados de imagen, que Claude no puede leer así.
export async function fetchFileContentBlock(url: string): Promise<{ type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/webp"; data: string } } | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo leer el archivo (${res.status}).`);
  const contentType = res.headers.get("content-type") ?? "";
  const buf = await res.arrayBuffer();
  const data = Buffer.from(buf).toString("base64");
  if (contentType.includes("pdf")) {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  }
  const mediaType = contentType.includes("png") ? "image/png" : contentType.includes("webp") ? "image/webp" : "image/jpeg";
  return { type: "image", source: { type: "base64", media_type: mediaType, data } };
}

function extractJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("La IA no devolvió un JSON reconocible.");
  return JSON.parse(match[0]) as T;
}

export type QuoteReadResult = {
  readTotal: number | null;
  productNameFound: string | null;
  referenceCodeFound: string | null;
};

// Lee una cotización UNA VEZ por solicitud (no es un chat) — extrae el total,
// y el nombre del producto si aparece, o el código de referencia si es lo
// único que trae (pasa seguido). El llamador decide qué hacer con esto
// (comparar contra lo escrito, pedir confirmación manual, etc.) — esta
// función solo extrae.
export async function readPurchaseQuote(params: {
  quoteImageUrl: string;
  actorId: string;
  deptId?: string;
}): Promise<QuoteReadResult> {
  const client = getAnthropicClient();
  const { data, mediaType } = await fetchImageBase64(params.quoteImageUrl);

  const response = await client.messages.create({
    model: PURCHASE_AI_MODEL,
    max_tokens: 1024,
    system:
      "Lees cotizaciones/facturas de proveedores para Control de Compras de Provedix (Guayaquil, Ecuador). " +
      "Extrae SOLO lo que de verdad está en la imagen — nunca inventes un valor. " +
      'Responde ÚNICAMENTE un JSON: {"readTotal": number|null, "productNameFound": string|null, "referenceCodeFound": string|null}. ' +
      "readTotal es el monto TOTAL a pagar que muestra el documento (sin símbolo de moneda). " +
      "productNameFound es el nombre del producto si aparece descrito con palabras. " +
      "referenceCodeFound es un código/SKU del proveedor si eso es lo único que identifica al producto (sin nombre descriptivo). " +
      "Si no encuentras alguno de estos tres datos, pon null en ese campo — no adivines.",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data } },
          { type: "text", text: "Lee esta cotización y devuelve el JSON pedido." },
        ],
      },
    ],
  });

  await logAiUsage({
    feature: "control_compras_cotizacion",
    model: PURCHASE_AI_MODEL,
    actorId: params.actorId,
    deptId: params.deptId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("La IA no devolvió contenido de texto.");
  return extractJson<QuoteReadResult>(textBlock.text);
}

export type PaymentProofReadResult = {
  readAmount: number | null;
  // Confirmado 2026-08-11: N° de comprobante/transacción/referencia del
  // banco (o de caja chica) — se usa para detectar si el mismo comprobante
  // se reutiliza por error en otra solicitud. Null si no se distingue.
  receiptNumber: string | null;
};

// Confirmado 2026-08-04: antes de aprobar/pagar, la IA lee el comprobante de
// transferencia (o el de caja chica) y devuelve el monto — el llamador lo
// compara contra lo que de verdad correspondía pagar (mercadería o flete) y
// bloquea seguir si no cuadra, para que un sobrepago por error no pase
// desapercibido. Igual que la cotización: se lee UNA vez, nunca se inventa
// un valor si no aparece.
export async function readPaymentProof(params: {
  proofImageUrl: string;
  actorId: string;
  deptId?: string;
}): Promise<PaymentProofReadResult> {
  const client = getAnthropicClient();
  const fileBlock = await fetchFileContentBlock(params.proofImageUrl);

  const response = await client.messages.create({
    model: PURCHASE_AI_MODEL,
    max_tokens: 512,
    system:
      "Lees comprobantes de pago (transferencia bancaria o recibo de caja chica) para Control de Compras de " +
      "Provedix (Guayaquil, Ecuador). Extrae SOLO el monto que de verdad muestra el comprobante como transferido o " +
      "pagado — nunca inventes un valor. También extrae el número de comprobante/transacción/referencia del banco " +
      "(puede aparecer como 'N° de comprobante', 'N° de transacción', 'Número de referencia', 'ID de transacción', " +
      "'Nro. de operación', etc. — usa el que encuentres). " +
      'Responde ÚNICAMENTE un JSON: {"readAmount": number|null, "receiptNumber": string|null}. ' +
      "readAmount es el monto total transferido/pagado (sin símbolo de moneda). receiptNumber es el número de " +
      "comprobante tal como aparece (letras y números tal cual). Si no se distingue con claridad, pon null en cualquiera de los dos.",
    messages: [
      {
        role: "user",
        content: [
          fileBlock,
          { type: "text", text: "Lee este comprobante de pago y devuelve el JSON pedido." },
        ],
      },
    ],
  });

  await logAiUsage({
    feature: "control_compras_comprobante_pago",
    model: PURCHASE_AI_MODEL,
    actorId: params.actorId,
    deptId: params.deptId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("La IA no devolvió contenido de texto.");
  return extractJson<PaymentProofReadResult>(textBlock.text);
}

export type PurchaseOrderReadResult = {
  readTotal: number | null;
};

// Confirmado 2026-08-06: cuando la cotización solo trae un código (sin
// nombre de producto) y la orden de compra pasa a ser obligatoria, la IA
// también la lee UNA vez y su monto se cruza contra lo que la persona
// escribió a mano — el mismo total que ya se comparó contra la cotización.
// Objetivo explícito del usuario: que cotización, lo tipeado a mano, y la
// orden de compra sean transparentes entre sí en cuanto a precio y pagos,
// no solo dos de los tres documentos.
export async function readPurchaseOrder(params: {
  purchaseOrderUrl: string;
  actorId: string;
  deptId?: string;
}): Promise<PurchaseOrderReadResult> {
  const client = getAnthropicClient();
  const fileBlock = await fetchFileContentBlock(params.purchaseOrderUrl);

  const response = await client.messages.create({
    model: PURCHASE_AI_MODEL,
    max_tokens: 512,
    system:
      "Lees órdenes de compra para Control de Compras de Provedix (Guayaquil, Ecuador). " +
      "Extrae SOLO el monto TOTAL que de verdad muestra el documento — nunca inventes un valor. " +
      'Responde ÚNICAMENTE un JSON: {"readTotal": number|null}. ' +
      "readTotal es el monto TOTAL de la orden de compra (sin símbolo de moneda). Si no se distingue con claridad, pon null.",
    messages: [
      {
        role: "user",
        content: [fileBlock, { type: "text", text: "Lee esta orden de compra y devuelve el JSON pedido." }],
      },
    ],
  });

  await logAiUsage({
    feature: "control_compras_orden_compra",
    model: PURCHASE_AI_MODEL,
    actorId: params.actorId,
    deptId: params.deptId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("La IA no devolvió contenido de texto.");
  return extractJson<PurchaseOrderReadResult>(textBlock.text);
}

export type ReceiptPhotoComparisonResult = {
  likelyMatch: boolean | null;
  note: string;
  // Confirmado 2026-08-12 (ampliado el mismo día): cuando likelyMatch es
  // false, distinguir si sigue siendo el MISMO producto que la referencia
  // con una diferencia MENOR (color, logo, detalle de empaque/etiqueta,
  // etc.) de un producto genuinamente distinto (otra forma/diseño/tamaño/
  // tipo). Solo en el primer caso la UI ofrece un botón de un clic para que
  // el líder de Inventario decida si lo deja pasar o lo reporta — un
  // producto realmente distinto sigue bloqueado igual que antes.
  minorDifferenceOnly: boolean;
};

// Confirmado 2026-08-06: cuando Daniel (líder de Inventario) confirma que
// llegó la mercadería, sube 2-3 fotos y la IA las compara UNA vez contra las
// fotos de referencia del producto guardadas en el catálogo — solo apoyo
// visual (no cuenta unidades, no es una medición exacta), NUNCA bloquea:
// el líder sigue siendo quien de verdad confirma cantidad y producto.
export async function compareReceiptPhotos(params: {
  referencePhotoUrls: string[];
  receivedPhotoUrls: string[];
  actorId: string;
  deptId?: string;
}): Promise<ReceiptPhotoComparisonResult> {
  if (params.referencePhotoUrls.length === 0) {
    return { likelyMatch: null, minorDifferenceOnly: false, note: "Este producto no tiene fotos de referencia en el catálogo — no se pudo comparar." };
  }

  const client = getAnthropicClient();
  const [refBlocks, receivedBlocks] = await Promise.all([
    Promise.all(params.referencePhotoUrls.map((u) => fetchFileContentBlock(u))),
    Promise.all(params.receivedPhotoUrls.map((u) => fetchFileContentBlock(u))),
  ]);

  const response = await client.messages.create({
    model: PURCHASE_AI_MODEL,
    max_tokens: 512,
    system:
      "Ayudas a Inventario de Provedix (Guayaquil, Ecuador) a confirmar que la mercadería que llegó es el producto " +
      "correcto. Te doy fotos DE REFERENCIA del producto que se pidió (del catálogo) y fotos de lo que de verdad " +
      "llegó (tomadas por el líder de Inventario al recibir). Compara si visualmente parece el MISMO producto — " +
      "esto es solo una referencia visual de apoyo, no una medición exacta ni un conteo de unidades. " +
      // Confirmado 2026-08-08: antes se permitía un veredicto "coincide" aunque
      // una de varias fotos de recepción no correspondiera al producto —
      // resultado incorrecto de baja confianza. Ahora CUALQUIER foto de
      // recepción que no corresponda visualmente a las de referencia hace que
      // el veredicto general sea false, sin importar si las demás sí coinciden.
      "Si CUALQUIERA de las fotos de recepción no corresponde visualmente al producto de referencia (aunque las " +
      "demás sí coincidan), likelyMatch debe ser false — nunca lo marques true si hay aunque sea una duda real. " +
      "Cuando likelyMatch sea false, determina además si SIGUE SIENDO EL MISMO PRODUCTO que la referencia — " +
      "misma forma, mismo diseño, mismo uso, misma categoría — pero con una diferencia MENOR (ej. color, logo, " +
      "un detalle del empaque o la etiqueta): en ese caso minorDifferenceOnly debe ser true. Si es un producto " +
      "GENUINAMENTE DISTINTO — otra forma, otro diseño, otro tamaño, otro tipo de producto — minorDifferenceOnly " +
      "debe ser false. Ante la duda de si es o no el mismo producto, marca minorDifferenceOnly como false (el " +
      "líder de Inventario decide con más contexto, pero solo debe ver la opción rápida cuando es claramente el " +
      "mismo producto). Cuando likelyMatch es true, minorDifferenceOnly siempre debe ser false. " +
      'Responde ÚNICAMENTE un JSON: {"likelyMatch": boolean, "minorDifferenceOnly": boolean, "note": string}. ' +
      'note es una frase breve en español explicando tu conclusión, mencionando específicamente cuál foto no ' +
      'corresponde y qué cambia si aplica (ej. "Coincide — mismo empaque y forma" o "No coincide — la 3ra foto ' +
      'de recepción muestra un producto distinto (otra forma)" o "No coincide — mismo producto pero llegó en ' +
      'color gris en vez de amarillo").',
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Fotos DE REFERENCIA (lo que se pidió):" },
          ...refBlocks,
          { type: "text", text: "Fotos de lo que llegó (recepción):" },
          ...receivedBlocks,
          { type: "text", text: "Devuelve el JSON pedido." },
        ],
      },
    ],
  });

  await logAiUsage({
    feature: "control_compras_recepcion_fotos",
    model: PURCHASE_AI_MODEL,
    actorId: params.actorId,
    deptId: params.deptId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("La IA no devolvió contenido de texto.");
  const result = extractJson<ReceiptPhotoComparisonResult>(textBlock.text);
  return { ...result, minorDifferenceOnly: result.likelyMatch === false && !!result.minorDifferenceOnly };
}

export type PurchaseGroupReviewResult = {
  ok: boolean;
  summary: string;
};

// Confirmado 2026-09-04: pedido explícito del usuario (admin/Andrés) — hasta
// ahora cada dato de una solicitud se validaba por separado (cotización al
// solicitar, justificación de precio, crédito, etc.), pero admin igual tenía
// que entrar a revisar cada solicitud aprobada a mano antes de pagar. Esta
// función corre UNA vez, en cuanto Bryan aprueba, y arma una revisión
// consolidada en español simple con TODO lo ya cargado — no vuelve a leer
// imágenes (esas ya se leyeron y validaron en su paso correspondiente), solo
// cruza los datos ya confirmados para que admin confíe en el resultado sin
// tener que revisar cada campo uno por uno.
export async function reviewApprovedPurchaseGroup(params: {
  actorId: string | null;
  deptId?: string;
  supplierName: string;
  requestNumber: number | null;
  lines: { name: string; justCode: string | null; quantity: number; unitCost: number; totalCost: number; justification: string | null }[];
  totalCost: number;
  quoteReadTotal: number | null;
  quoteReferenceCode: string | null;
  hasPurchaseOrder: boolean;
  bankAccount: { bankName: string; bankAccountType: string; bankAccountNumber: string; bankAccountHolder: string } | null;
  reservedCreditTotal: number;
  creditSkipJustification: string | null;
}): Promise<PurchaseGroupReviewResult> {
  const client = getAnthropicClient();

  const facts = {
    proveedor: params.supplierName,
    codigo_solicitud: params.requestNumber ? `SC-${String(params.requestNumber).padStart(3, "0")}` : null,
    productos: params.lines.map((l) => ({
      nombre: l.name,
      codigo_catalogo: l.justCode,
      cantidad: l.quantity,
      precio_unitario: l.unitCost,
      subtotal: l.totalCost,
      justificacion_precio_sobre_historial: l.justification,
    })),
    total_a_pagar_por_las_lineas: params.totalCost,
    total_leido_por_ia_en_la_cotizacion_al_solicitar: params.quoteReadTotal,
    cotizacion_solo_traia_codigo_sin_nombre: !!params.quoteReferenceCode,
    tiene_orden_de_compra_de_respaldo: params.hasPurchaseOrder,
    cuenta_bancaria_para_transferir: params.bankAccount,
    credito_con_proveedor_ya_aplicado: params.reservedCreditTotal,
    justificacion_de_no_aplicar_credito_disponible: params.creditSkipJustification,
  };

  const response = await client.messages.create({
    model: PURCHASE_AI_MODEL,
    max_tokens: 500,
    system:
      "Eres el último control antes de pagar en Control de Compras de Provedix (Guayaquil, Ecuador). Cada dato que " +
      "te doy YA fue validado en su propio paso (cotización leída por IA al solicitar, precio justificado si superó " +
      "el historial, crédito con el proveedor ya reservado, etc.) — tu trabajo es cruzarlos TODOS juntos una vez " +
      "más y darle a Andrés (quien va a pagar) la confianza de que no hay que revisar nada a mano. " +
      "Verifica específicamente: (1) que total_a_pagar_por_las_lineas coincida con total_leido_por_ia_en_la_cotizacion_al_solicitar " +
      "(si este último es null, no lo marques como problema — pasa cuando la cotización solo traía código); " +
      "(2) que CUALQUIER producto con justificacion_precio_sobre_historial en null tenga sentido como precio normal " +
      "(no puedes saber el historial exacto, así que no inventes un problema aquí — solo repórtalo si el patrón se ve " +
      "claramente anómalo, ej. precio 0 o negativo); (3) que si cotizacion_solo_traia_codigo_sin_nombre es true, " +
      "tiene_orden_de_compra_de_respaldo también sea true; (4) que cuenta_bancaria_para_transferir no sea null; " +
      "(5) que si hay credito_con_proveedor_ya_aplicado en 0 pero no hay justificacion_de_no_aplicar_credito_disponible, " +
      "lo señales (podría haber crédito sin usar). " +
      'Responde ÚNICAMENTE un JSON: {"ok": boolean, "summary": string}. ' +
      "Si TODO está en orden, ok=true y summary es UNA frase breve y clara en español simple confirmándolo (ej. " +
      "\"Todo cuadra: el total, el precio y la cuenta bancaria coinciden con lo revisado — puedes pagar con confianza.\"). " +
      "Si algo no cuadra o falta, ok=false y summary dice EXACTAMENTE qué revisar, en español simple, sin tecnicismos. " +
      "Nunca inventes datos que no te di.",
    messages: [{ role: "user", content: `Datos ya confirmados de esta operación aprobada:\n${JSON.stringify(facts, null, 2)}\n\nDevuelve el JSON pedido.` }],
  });

  await logAiUsage({
    feature: "control_compras_revision_pago",
    model: PURCHASE_AI_MODEL,
    actorId: params.actorId ?? "admin",
    deptId: params.deptId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("La IA no devolvió contenido de texto.");
  return extractJson<PurchaseGroupReviewResult>(textBlock.text);
}

export type CatalogDuplicateCheck = {
  suspected: boolean;
  matchedName: string | null;
  message: string | null;
};

// Segunda capa del catálogo (más allá del match exacto por nombre, que se
// resuelve directo en la base de datos): ¿el nombre nuevo se parece a uno ya
// existente sin ser idéntico? — confirmado 2026-07-30, ej. "cinta roja" vs
// "Rollos de cinta de embalaje" ya existente. No bloquea, solo avisa — la
// persona decide si de verdad es distinto.
export async function checkCatalogNameSimilarity(params: {
  candidateName: string;
  actorId: string;
}): Promise<CatalogDuplicateCheck> {
  const existing = await prisma.purchaseCatalogItem.findMany({ select: { name: true }, orderBy: { name: "asc" } });
  if (existing.length === 0) return { suspected: false, matchedName: null, message: null };

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: PURCHASE_AI_MODEL,
    max_tokens: 512,
    system:
      "Ayudas a evitar productos duplicados en el catálogo de Control de Compras de Provedix. " +
      "Te doy un nombre nuevo y la lista de nombres que YA existen. Busca si el nombre nuevo podría ser " +
      "el MISMO producto que uno ya existente, escrito distinto (ej. abreviado, con typo, orden de palabras distinto) — " +
      "no productos simplemente relacionados o de la misma categoría. " +
      'Responde SOLO un JSON: {"suspected": boolean, "matchedName": string|null, "message": string|null}. ' +
      "message es una pregunta breve en español para confirmarle a la persona, solo si suspected=true, ej. " +
      '"¿Esto es lo mismo que \'X\' que ya existe, o es un producto realmente diferente?"',
    messages: [
      {
        role: "user",
        content: `Nombre nuevo: "${params.candidateName}"\n\nNombres que ya existen:\n${existing.map((e) => `- ${e.name}`).join("\n")}`,
      },
    ],
  });

  await logAiUsage({
    feature: "control_compras_catalogo",
    model: PURCHASE_AI_MODEL,
    actorId: params.actorId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return { suspected: false, matchedName: null, message: null };
  return extractJson<CatalogDuplicateCheck>(textBlock.text);
}
