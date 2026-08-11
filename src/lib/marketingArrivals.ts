import { prisma } from "@/lib/prisma";

// Confirmado 2026-08-08: "Mercadería recibida" — pedido explícito del
// usuario para que Análisis de Mercado (MKT) sepa apenas Daniel confirma
// algo como recibido, y cada quien haga su parte (Robert diseña, Heidy o
// Jariel asesoran) sin tener que abrir Control de Compras.
export const MKT_DEPT_CODE = "MKT";

const arrivalInclude = {
  catalogItem: { select: { name: true, photos: true } },
  receipt: { select: { photoUrls: true, receivedQuantity: true, confirmedAt: true } },
  marketingFollowUp: {
    include: {
      designConfirmedBy: { select: { name: true } },
      advisorConfirmedBy: { select: { name: true, marketingAdvisorBrand: true } },
    },
  },
};

export async function getMarketingArrivals() {
  const rows = await prisma.purchaseRequest.findMany({
    where: { status: "RECEIVED" },
    orderBy: { receipt: { confirmedAt: "desc" } },
    include: arrivalInclude,
  });
  return rows;
}

// Confirmado 2026-08-08: se le avisa a TODOS los que puedan confirmar ese
// rol (Robert es el único diseñador hoy, pero puede haber más de un
// asesor — Heidy Y Jariel se enteran de toda llegada, aunque en la
// práctica solo a uno de los dos le corresponda de verdad).
export async function getMarketingArrivalActorIds(role: "design" | "advisor"): Promise<string[]> {
  const flag = role === "design" ? { canConfirmMarketingDesign: true } : { canConfirmMarketingAdvisor: true };
  const users = await prisma.user.findMany({ where: { ...flag, isActive: true }, select: { id: true } });
  return users.map((u) => u.id);
}
