import { prisma } from "@/lib/prisma";

// Una guía de envío de garantía es única: no se registra dos veces como
// garantía (pedido del usuario 2026-10-17: "esos ID son únicos por cada
// garantía"). Los reenvíos de Arreglos de garantía y las garantías de Rocket
// se cruzan entre sí. Garantías por despachar se revisa aparte (solo contra sí
// misma): ahí la misma garantía puede volver a anotarse para que Joao la saque,
// y eso no es una garantía nueva. Devuelve el error a mostrar, o null.
export async function warrantyGuideAlreadyUsedError(
  guideNumber: string,
  except: { arrangementId?: string; rocketWarrantyId?: string } = {},
): Promise<string | null> {
  const [arrangement, rocket] = await Promise.all([
    prisma.warrantyArrangement.findFirst({
      where: { guideNumber, ...(except.arrangementId ? { id: { not: except.arrangementId } } : {}) },
      select: { number: true },
    }),
    prisma.rocketWarranty.findFirst({
      where: { guideNumber, ...(except.rocketWarrantyId ? { id: { not: except.rocketWarrantyId } } : {}) },
      select: { number: true },
    }),
  ]);
  if (arrangement) return `La guía ${guideNumber} ya fue usada en el arreglo AR-${String(arrangement.number).padStart(4, "0")}. Cada guía se usa una sola vez.`;
  if (rocket) return `La guía ${guideNumber} ya es de la garantía de Rocket GR-${String(rocket.number).padStart(4, "0")}. Cada guía se usa una sola vez.`;
  return null;
}
