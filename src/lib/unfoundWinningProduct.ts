import { z } from "zod";

// Confirmado 2026-09-22, pedido de Jariel: "productos ganadores no
// encontrados" — compartido entre POST (crear) y PATCH (editar).
export const unfoundWinningProductSchema = z.object({
  productName: z.string().trim().min(1, "Falta el nombre del producto."),
  imageUrl: z.string().url("Falta la imagen del producto."),
  competitorId: z.string().trim().max(100).optional(),
  competitorPrice: z.number().positive("El precio de la competencia debe ser mayor a 0.").optional(),
  supplierId: z.string().optional(),
  notes: z.string().trim().max(500).optional(),
});

export const unfoundWinningProductInclude = {
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { name: true } },
  proposal: { select: { id: true, code: true, status: true } },
} as const;
