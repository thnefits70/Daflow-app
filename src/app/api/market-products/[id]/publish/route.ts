import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canPublishMarketProduct } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { getNewIdBrandingActorIds } from "@/lib/newIdBranding";

const schema = z.object({
  quantity: z.number().int().positive().default(100),
  dropiProductId: z.string().trim().min(1, "Falta el ID de Dropi."),
});

// Confirmado 2026-09-09 (Fase 2, Análisis de Mercado): Heidy publica el
// producto ya aprobado en Dropi (nombre, cantidad por defecto 100,
// imágenes) y confirma con el ID real que Dropi le da. Recién en ESTE
// momento — no antes, el ID no existe hasta ahora — le llega a Daniel y a
// Robert.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canPublishMarketProduct()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const existing = await prisma.marketProductProposal.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.status !== "APPROVED") return NextResponse.json({ error: "Este producto todavía no está aprobado." }, { status: 409 });
  if (existing.publishedAt) return NextResponse.json({ error: "Ya está publicado." }, { status: 409 });

  const updated = await prisma.marketProductProposal.update({
    where: { id },
    data: { dropiProductId: parsed.data.dropiProductId, publishedById: session.user.id, publishedAt: new Date() },
  });

  const inventoryLead = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "INV" } }, select: { id: true } });
  if (inventoryLead) {
    await notifyOwner(inventoryLead.id, {
      title: "Producto publicado en Dropi",
      body: `${existing.productName} — ID ${parsed.data.dropiProductId}`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  // Confirmado 2026-09-18: ya con el ID confirmado por Heidy, Bryan puede
  // liberar al Kardex cualquier compra de este producto que ya haya llegado
  // mientras se esperaba (ver release-kardex/route.ts).
  const marketingLead = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "MKT" } }, select: { id: true } });
  if (marketingLead) {
    await notifyOwner(marketingLead.id, {
      title: "ID de Dropi confirmado — falta liberar al Kardex",
      body: `${existing.productName} ya tiene ID de Dropi. Confírmalo para sumar al Kardex lo que ya haya llegado.`,
      url: "/area/workspace?tab=analisis-mercado",
    }).catch(() => null);
  }

  // Confirmado 2026-09-22, pedido explícito del usuario: en este mismo
  // instante (ID ya confirmado por Heidy) Robert se entera de que ya puede
  // brandear — antes solo lo veía si abría la pestaña "Brandear" por su
  // cuenta. Se avisa a todos los que tengan el permiso, no por nombre.
  // Confirmado 2026-09-23: el brandeo ahora vive en "Nuevos IDs por brandear"
  // y le llega a quien brandea (Robert tiene canConfirmMarketingDesign, no el
  // flag viejo canBrandMarketProduct, así que antes este aviso no le llegaba).
  const brandUserIds = await getNewIdBrandingActorIds();
  await Promise.all(
    brandUserIds.map((uid) =>
      notifyOwner(uid, {
        title: "Nuevo producto para brandear",
        body: `${existing.productName} — ID Dropi ${parsed.data.dropiProductId}. Sube las fotos y el video brandeados.`,
        url: "/area/workspace?tab=nuevos-ids",
      }).catch(() => null)
    )
  );

  return NextResponse.json(updated);
}
