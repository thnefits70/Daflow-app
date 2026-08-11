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

// Cuántas llegadas todavía esperan la confirmación de ESTE actor puntual —
// usado tanto por el badge/lista como por el sondeo del aviso en pantalla
// (src/components/marketing/MarketingArrivalAlert.tsx).
export async function getPendingMarketingArrivalCount(role: "design" | "advisor"): Promise<number> {
  const where = role === "design" ? { designConfirmedAt: null } : { advisorConfirmedAt: null };
  return prisma.purchaseReceiptFollowUp.count({ where });
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

export type StaleMarketingArrivalPush = { ownerId: string; title: string; body: string; url: string };

// Confirmado 2026-08-08: mismo espíritu que getStalePurchaseRequestPushes —
// mientras falte una confirmación, se sigue avisando cada día (el cron ya
// corre una vez al día), para que nadie se olvide.
export async function getStaleMarketingArrivalPushes(): Promise<StaleMarketingArrivalPush[]> {
  const pushes: StaleMarketingArrivalPush[] = [];
  const pending = await prisma.purchaseReceiptFollowUp.findMany({
    where: { OR: [{ designConfirmedAt: null }, { advisorConfirmedAt: null }] },
    include: { request: { select: { quantity: true, catalogItem: { select: { name: true } } } } },
  });
  if (pending.length === 0) return pushes;

  const [designIds, advisorIds] = await Promise.all([
    getMarketingArrivalActorIds("design"),
    getMarketingArrivalActorIds("advisor"),
  ]);

  for (const f of pending) {
    const body = `${f.request.catalogItem.name} · ${f.request.quantity} un.`;
    if (!f.designConfirmedAt) {
      for (const id of designIds) pushes.push({ ownerId: id, title: "Llegó mercadería — falta subir fotos/video", body, url: "/area/workspace?tab=llegadas" });
    }
    if (!f.advisorConfirmedAt) {
      for (const id of advisorIds) pushes.push({ ownerId: id, title: "Llegó mercadería — falta verificar", body, url: "/area/workspace?tab=llegadas" });
    }
  }
  return pushes;
}
