import { getAnthropicClient } from "@/lib/nancy";
import { logAiUsage } from "@/lib/aiUsage";
import { prisma } from "@/lib/prisma";
import { fetchFileContentBlock } from "@/lib/purchaseAi";

const REENTRY_AI_MODEL = "claude-sonnet-5";

// Confirmado 2026-08-19: mientras el catálogo de productos matriculados siga
// creciendo, se manda como máximo 1 foto por candidato (la primera) y un
// tope de candidatos, para que el prompt no se dispare de tamaño/costo. Si
// el catálogo real supera este tope, revisar esto — por ahora la empresa
// todavía está matriculando productos y el catálogo es chico.
const MAX_CANDIDATES = 60;

function extractJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("La IA no devolvió un JSON reconocible.");
  return JSON.parse(match[0]) as T;
}

export type ProductIdentifyResult = {
  catalogItemId: string | null;
  note: string;
};

// Reconocimiento visual de un producto reingresado contra TODO el catálogo
// de productos matriculados (PurchaseCatalogItem, reusado de Control de
// Compras — confirmado explícitamente por el usuario 2026-08-19). A
// diferencia de compareReceiptPhotos (que compara 1 producto conocido
// contra su propia referencia), acá se busca CUÁL de muchos candidatos es,
// si es que alguno lo es — el catálogo sigue incompleto, así que "ninguno
// coincide" es un resultado esperado y frecuente, no un error.
export async function identifyReturnedProduct(params: {
  photoUrl: string;
  actorId: string;
  deptId?: string;
}): Promise<ProductIdentifyResult> {
  const candidates = await prisma.purchaseCatalogItem.findMany({
    where: { photos: { isEmpty: false } },
    select: { id: true, name: true, photos: true },
    orderBy: { name: "asc" },
    take: MAX_CANDIDATES,
  });
  if (candidates.length === 0) {
    return { catalogItemId: null, note: "El catálogo todavía no tiene productos con foto para comparar." };
  }

  const client = getAnthropicClient();
  const [photoBlock, ...candidateBlocks] = await Promise.all([
    fetchFileContentBlock(params.photoUrl),
    ...candidates.map((c) => fetchFileContentBlock(c.photos[0])),
  ]);

  const candidateContent = candidates.flatMap((c, i) => [
    { type: "text" as const, text: `Candidato ${i + 1} — id "${c.id}" — nombre "${c.name}":` },
    candidateBlocks[i],
  ]);

  const response = await client.messages.create({
    model: REENTRY_AI_MODEL,
    max_tokens: 512,
    system:
      "Ayudas a Inventario de Provedix (Guayaquil, Ecuador) a reconocer mercadería devuelta comparándola contra el " +
      "catálogo YA MATRICULADO de productos. Te doy una foto del producto que acaba de reingresar y una lista " +
      "numerada de candidatos del catálogo, cada uno con su foto de referencia. Busca si el producto reingresado " +
      "es VISUALMENTE el mismo que alguno de los candidatos — misma forma, mismo diseño, mismo empaque. El " +
      "catálogo todavía está incompleto, así que 'ninguno coincide' es un resultado normal y frecuente, no un " +
      "error — nunca elijas el candidato 'más parecido' si no estás razonablemente seguro de que es el mismo " +
      "producto. " +
      'Responde ÚNICAMENTE un JSON: {"matchedCandidateId": string|null, "note": string}. ' +
      "matchedCandidateId es el id exacto del candidato que coincide, o null si ninguno coincide con seguridad. " +
      "note es una frase breve en español explicando la conclusión.",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Foto del producto reingresado:" },
          photoBlock,
          { type: "text", text: "Candidatos del catálogo:" },
          ...candidateContent,
          { type: "text", text: "Devuelve el JSON pedido." },
        ],
      },
    ],
  });

  await logAiUsage({
    feature: "reingreso_mercaderia_reconocimiento",
    model: REENTRY_AI_MODEL,
    actorId: params.actorId,
    deptId: params.deptId,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("La IA no devolvió contenido de texto.");
  const result = extractJson<{ matchedCandidateId: string | null; note: string }>(textBlock.text);

  const matched = result.matchedCandidateId ? candidates.find((c) => c.id === result.matchedCandidateId) : null;
  return { catalogItemId: matched?.id ?? null, note: result.note ?? "" };
}
