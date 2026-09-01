import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { prisma } from "@/lib/prisma";

// Confirmado 2026-08-31: la IA sugiere un nicho UNA sola vez por producto
// (nunca se recalcula por vista) — mismo patrón que generateQuestionsForContent
// en learningPathAi.ts. El resultado se guarda en PurchaseCatalogItem.nicho y
// de ahí en adelante es un campo de texto editable normal, sin volver a
// llamar a la IA. Se usa para cruzar productos ganadores de ATOM con
// productos de baja rotación del mismo nicho (Sugerencias de Combos).
export const NICHO_AI_MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `Eres un especialista en catálogo de e-commerce para DAFLOW (Provedix, Guayaquil, Ecuador), que vende productos de dropshipping por catálogo.

Tu tarea: dado el nombre (y opcionalmente una breve descripción) de UN producto, sugiere un "nicho" corto — la categoría de interés/uso a la que pertenece, tal como se usaría para agrupar productos afines en una tienda (ej. "Belleza y cuidado personal", "Hogar y organización", "Electrónica y gadgets", "Mascotas", "Deporte y fitness", "Bebés y niños", "Cocina", "Herramientas").

Reglas:
- Responde con 1 a 3 palabras, en español, con mayúscula inicial.
- No inventes información que no puedas inferir razonablemente del nombre/descripción.
- Si el producto podría encajar en varios nichos, elige el más específico y útil para agrupar productos similares.

Responde ÚNICAMENTE con un objeto JSON (sin texto adicional, sin markdown) con esta forma exacta:
{ "nicho": "..." }`;

function parseNichoResponse(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("La IA no devolvió un JSON válido.");
  }
  if (typeof parsed !== "object" || parsed === null || typeof (parsed as { nicho?: unknown }).nicho !== "string") {
    throw new Error("La respuesta de la IA no tiene la forma esperada.");
  }
  const nicho = (parsed as { nicho: string }).nicho.trim();
  if (!nicho) throw new Error("La IA no sugirió ningún nicho.");
  return nicho;
}

export async function suggestNicho(product: { name: string; description?: string | null }, actorId: string): Promise<string> {
  const client = getAnthropicClient();
  const promptText = product.description ? `Producto: "${product.name}"\nDescripción: "${product.description}"` : `Producto: "${product.name}"`;

  const response = await client.messages.create({
    model: NICHO_AI_MODEL,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: promptText }],
  });

  await logAiUsage({
    feature: "combo_sugerencias_nicho",
    model: NICHO_AI_MODEL,
    actorId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("La IA no devolvió contenido de texto.");
  return parseNichoResponse(textBlock.text);
}

// Confirmado 2026-09-01: pedido explícito del usuario — automático, sin
// depender de que nadie haga clic. Se llama vía after() (next/server) justo
// después de crear un producto nuevo, para no bloquear la respuesta de la
// acción que lo creó. Best-effort: si falla, no revienta nada — el producto
// simplemente se queda sin nicho hasta que alguien lo asigne a mano.
export async function suggestNichoIfMissing(catalogItemId: string, actorId = "system"): Promise<void> {
  try {
    const item = await prisma.purchaseCatalogItem.findUnique({
      where: { id: catalogItemId },
      select: { name: true, description: true, nicho: true },
    });
    if (!item || item.nicho) return;
    const nicho = await suggestNicho(item, actorId);
    await prisma.purchaseCatalogItem.update({ where: { id: catalogItemId }, data: { nicho } });
  } catch (err) {
    console.error(`No se pudo sugerir nicho automático para ${catalogItemId}:`, err);
  }
}
