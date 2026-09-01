import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { getCatalogItemPriceStats } from "@/lib/purchases";
import { actorName } from "@/lib/actorName";
import { suggestNichoIfMissing } from "@/lib/nichoAi";

// Confirmado 2026-08-06: quien creó un producto puede eliminarlo él mismo
// dentro de las primeras 2 horas desde que lo creó (ver DELETE en
// [id]/route.ts, que vuelve a validar esto server-side) — se calcula acá
// mismo un booleano `canDelete` por producto para que el cliente no necesite
// saber quién lo creó ni hacer el cálculo de tiempo por su cuenta.
const OWN_DELETE_WINDOW_MS = 2 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!(await canSubmitPurchaseRequests()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const isAdmin = session.user.role === "admin";
  function canDelete(i: { createdById: string | null; createdAt: Date }) {
    if (isAdmin) return true;
    if (i.createdById !== session!.user.id) return false;
    return Date.now() - i.createdAt.getTime() <= OWN_DELETE_WINDOW_MS;
  }
  // Confirmado 2026-08-06: si quien creó el insumo ya no puede borrarlo él
  // mismo (pasaron más de 2h, o ya tiene compras), puede pedirle al admin
  // que lo borre — mientras no haya ya una solicitud pendiente para ese
  // mismo insumo.
  function canRequestDelete(i: { createdById: string | null; deleteRequest: unknown }) {
    if (isAdmin) return false;
    if (i.createdById !== session!.user.id) return false;
    if (i.deleteRequest) return false;
    return true;
  }

  const withStats = req.nextUrl.searchParams.get("withStats") === "1";
  const items = await prisma.purchaseCatalogItem.findMany({
    orderBy: { name: "asc" },
    include: { deleteRequest: { include: { requestedBy: { select: { name: true } } } } },
  });

  function toDTO(i: (typeof items)[number]) {
    return {
      id: i.id,
      name: i.name,
      photos: i.photos,
      description: i.description,
      code: i.code,
      justCode: i.justCode,
      pendingRegistration: i.pendingRegistration,
      hasPendingDelete: !!i.deleteRequest,
      canDelete: canDelete(i),
      canRequestDelete: canRequestDelete(i) && !canDelete(i),
      pendingDeleteRequest: isAdmin && i.deleteRequest
        ? { id: i.deleteRequest.id, reason: i.deleteRequest.reason, requestedByName: actorName(i.deleteRequest.requestedBy?.name) }
        : null,
    };
  }

  if (!withStats) {
    return NextResponse.json(items.map(toDTO));
  }

  const withStatsData = await Promise.all(
    items.map(async (i) => ({ ...toDTO(i), stats: await getCatalogItemPriceStats(i.id) }))
  );
  return NextResponse.json(withStatsData);
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Falta el nombre del producto, mercadería o insumo."),
  // Confirmado 2026-08-21: pedido explícito del usuario — mínimo 3 fotos
  // reales o de referencia del proveedor, para que nadie en Compras/
  // Reingreso se equivoque de producto por no tener con qué reconocerlo.
  // Mismo criterio que complete-registration (matricular un esqueleto de
  // Just). No es retroactivo — productos creados antes con menos fotos
  // siguen funcionando igual.
  photos: z.array(z.string().url()).min(3, "Agrega mínimo 3 fotos del producto.").max(3),
  description: z.string().trim().max(500).optional(),
  code: z.string().trim().max(100).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canSubmitPurchaseRequests()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  // Chequeo de exactitud del lado del servidor — el frontend ya avisa antes
  // de llegar aquí, pero esto es lo que de verdad lo impide.
  const existing = await prisma.purchaseCatalogItem.findFirst({
    where: { name: { equals: parsed.data.name, mode: "insensitive" } },
  });
  if (existing) {
    return NextResponse.json(
      { error: `Ya existe "${existing.name}" en el catálogo — selecciónalo en vez de crear uno nuevo.`, existingId: existing.id },
      { status: 409 }
    );
  }

  const isAdmin = session.user.role === "admin";
  const item = await prisma.purchaseCatalogItem.create({
    data: {
      name: parsed.data.name,
      photos: parsed.data.photos,
      description: parsed.data.description || null,
      code: parsed.data.code || null,
      createdById: isAdmin ? null : session.user.id,
    },
  });

  // Confirmado 2026-09-01: pedido explícito del usuario — sugerencia de
  // nicho automática al crear cualquier producto nuevo, sin depender de
  // ningún clic. Corre después de responder, no retrasa la creación.
  after(() => suggestNichoIfMissing(item.id));

  return NextResponse.json(item, { status: 201 });
}
