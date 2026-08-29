import { prisma } from "@/lib/prisma";

// Confirmado 2026-08-08: "Mercadería recibida" — pedido explícito del
// usuario para que Análisis de Mercado (MKT) sepa apenas Daniel confirma
// algo como recibido, y cada quien haga su parte (Robert diseña, Heidy o
// Jariel asesoran) sin tener que abrir Control de Compras.
export const MKT_DEPT_CODE = "MKT";

const arrivalInclude = {
  catalogItem: { select: { name: true, photos: true, justCode: true } },
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

// Confirmado 2026-08-18: lista de quién puede confirmar cada rol, para que
// el panel arme filtros por persona ("lo que Jariel todavía no confirma") y
// pueda priorizar lo más antiguo primero sin tener que adivinar nombres.
export async function getMarketingArrivalConfirmers(): Promise<{ id: string; name: string; role: "design" | "advisor" }[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, OR: [{ canConfirmMarketingDesign: true }, { canConfirmMarketingAdvisor: true }] },
    select: { id: true, name: true, canConfirmMarketingDesign: true, canConfirmMarketingAdvisor: true },
  });
  const confirmers: { id: string; name: string; role: "design" | "advisor" }[] = [];
  for (const u of users) {
    if (u.canConfirmMarketingDesign) confirmers.push({ id: u.id, name: u.name, role: "design" });
    if (u.canConfirmMarketingAdvisor) confirmers.push({ id: u.id, name: u.name, role: "advisor" });
  }
  return confirmers;
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

// Confirmado 2026-08-28: quién debe enterarse por push de cada llegada para
// ir organizando el despacho (hoy Yair), sin poder confirmar diseño ni
// asesor — ver canViewMarketingArrivalsForDispatch en guards.ts.
export async function getMarketingArrivalDispatchViewerIds(): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { canViewMarketingArrivalsForDispatch: true, isActive: true }, select: { id: true } });
  return users.map((u) => u.id);
}
