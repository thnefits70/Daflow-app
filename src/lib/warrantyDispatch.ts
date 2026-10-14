import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnMerchandiseOutflow } from "@/lib/guards";
import { notifyOwner, resolveNotifications } from "@/lib/notifications";

// Garantías por despachar (pedido de Daniel 2026-10-14, ajustado por el
// usuario): Michelle y Yair suben la guía de una garantía ya autorizada con
// un comentario opcional; Joao la toma (visto) y saca la guía físicamente;
// Daniel o Allan revisan que esté correcto. No mueve stock — eso sigue
// saliendo del corte. Para sumar a alguien, ampliar estas listas.
const UPLOADER_USERNAMES = new Set(["mramirez", "yairurgilez"]);
const HANDLER_USERNAMES = new Set(["joao2026"]);
const VERIFIER_USERNAMES = new Set(["allan2026"]); // + Daniel (líder INV)

export const WARRANTY_DISPATCH_URL = "/area/workspace?tab=egresos&otab=garantias";
const TITLE_NEW = "Garantía para despachar";
const TITLE_REVIEW = "Garantía por revisar";

export type WarrantyDispatchRole = {
  userId: string;
  canUpload: boolean;
  canHandle: boolean;
  canVerify: boolean;
  isAdmin: boolean;
};

export async function getWarrantyDispatchRole(): Promise<WarrantyDispatchRole | null> {
  const session = await auth();
  if (!session) return null;
  const isAdmin = session.user.role === "admin";
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { username: true, isActive: true } });
  const active = !!user?.isActive;
  const name = user?.username ?? "";
  const role: WarrantyDispatchRole = {
    userId: session.user.id,
    canUpload: active && UPLOADER_USERNAMES.has(name),
    canHandle: active && HANDLER_USERNAMES.has(name),
    canVerify: active && (VERIFIER_USERNAMES.has(name) || (await canActOnMerchandiseOutflow())),
    isAdmin,
  };
  if (!role.canUpload && !role.canHandle && !role.canVerify && !isAdmin) return null;
  return role;
}

async function idsFor(usernames: Set<string>): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { username: { in: [...usernames] }, isActive: true }, select: { id: true } });
  return rows.map((r) => r.id);
}

async function verifierIds(): Promise<string[]> {
  const [extra, leaders] = await Promise.all([
    idsFor(VERIFIER_USERNAMES),
    prisma.user.findMany({ where: { isActive: true, isLeader: true, leadsDept: { code: "INV" } }, select: { id: true } }),
  ]);
  return [...new Set([...extra, ...leaders.map((l) => l.id)])];
}

export async function notifyHandlersNewGuide(guideNumber: string, uploaderName: string) {
  const ids = await idsFor(HANDLER_USERNAMES);
  await Promise.all(
    ids.map((id) =>
      notifyOwner(id, {
        title: TITLE_NEW,
        body: `Guía ${guideNumber} · subida por ${uploaderName}. Sácala y márcala con el visto.`,
        url: WARRANTY_DISPATCH_URL,
      }).catch(() => null),
    ),
  );
}

export async function resolveNewGuideNotice(guideNumber: string) {
  const ids = await idsFor(HANDLER_USERNAMES);
  await Promise.all(ids.map((id) => resolveNotifications(id, TITLE_NEW, `Guía ${guideNumber} ·`).catch(() => null)));
}

export async function notifyVerifiers(guideNumber: string, handlerName: string) {
  const ids = await verifierIds();
  await Promise.all(
    ids.map((id) =>
      notifyOwner(id, {
        title: TITLE_REVIEW,
        body: `Guía ${guideNumber} · ${handlerName} la está gestionando. Revisa que sea correcto.`,
        url: WARRANTY_DISPATCH_URL,
      }).catch(() => null),
    ),
  );
}

export async function resolveVerifierNotice(guideNumber: string) {
  const ids = await verifierIds();
  await Promise.all(ids.map((id) => resolveNotifications(id, TITLE_REVIEW, `Guía ${guideNumber} ·`).catch(() => null)));
}

// Pendientes + lo revisado en los últimos 30 días, con nombres.
export async function listWarrantyDispatchGuides() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.warrantyDispatchGuide.findMany({
    where: { OR: [{ verifiedAt: null }, { verifiedAt: { gte: since } }] },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const userIds = [...new Set(rows.flatMap((r) => [r.uploadedById, r.handledById, r.verifiedById]).filter((x): x is string => !!x))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const nameOf = (id: string | null) => (id ? users.find((u) => u.id === id)?.name ?? "—" : null);
  return rows.map((r) => ({
    id: r.id,
    guideNumber: r.guideNumber,
    fileUrl: r.fileUrl,
    fileName: r.fileName,
    comment: r.comment,
    createdAt: r.createdAt.toISOString(),
    uploadedById: r.uploadedById,
    uploadedByName: nameOf(r.uploadedById),
    handledAt: r.handledAt?.toISOString() ?? null,
    handledByName: nameOf(r.handledById),
    verifiedAt: r.verifiedAt?.toISOString() ?? null,
    verifiedByName: nameOf(r.verifiedById),
  }));
}

export async function userName(id: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id }, select: { name: true } });
  return u?.name ?? "—";
}
