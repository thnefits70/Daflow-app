// Precio por millón de tokens, en USD — actualizar aquí si Anthropic cambia
// precios o se agrega un modelo nuevo a algún feature de IA en DAFLOW.
const PRICING_PER_1M: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
};

export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING_PER_1M[model];
  if (!price) return 0;
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}
