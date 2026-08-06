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
      "pagado — nunca inventes un valor. " +
      'Responde ÚNICAMENTE un JSON: {"readAmount": number|null}. ' +
      "readAmount es el monto total transferido/pagado (sin símbolo de moneda). Si no se distingue con claridad, pon null.",
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
