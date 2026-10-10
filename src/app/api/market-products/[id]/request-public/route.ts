import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnMarketProductReview } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

// Aprobado por Bryan 2026-10-10: él decide pasar a público en Dropi un
// producto que quedó privado (p. ej. "Solo Rocket por ahora") y la asesora
// B2B lo ejecuta — le llega la notificación y el pendiente en Inicio.
// Si todavía no lo había publicado, simplemente lo publicará ya en público.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnMarketProductReview()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.marketProductProposal.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.status !== "APPROVED") return NextResponse.json({ error: "Este producto no está aprobado." }, { status: 409 });
  if (existing.isPublic || existing.publicRequestedAt) return NextResponse.json({ error: "Ya está público o ya se pidió pasarlo." }, { status: 409 });

  const notYetPublished = !existing.publishedAt;
  const updated = await prisma.marketProductProposal.update({
    where: { id },
    data: {
      publicRequestedAt: new Date(),
      publicRequestedById: session.user.role === "admin" ? null : session.user.id,
      // Sin ID todavía: la asesora lo publica directo en público, no hay nada
      // que cambiar después.
      ...(notYetPublished ? { isPublic: true, madePublicAt: new Date() } : {}),
    },
  });

  const advisors = await prisma.user.findMany({ where: { canPublishMarketProduct: true, isActive: true }, select: { id: true } });
  await Promise.all(
    advisors.map((u) =>
      notifyOwner(u.id, {
        title: "Pasar a público en Dropi",
        body: notYetPublished
          ? `${existing.productName} — publícalo en público (ya no va privado).`
          : `${existing.productName} — ID ${existing.dropiProductId}. Cámbialo a público en Dropi y confírmalo en DAFLOW.`,
        url: "/area/workspace?tab=analisis-mercado&ptab=publicar",
      }).catch(() => null)
    )
  );

  return NextResponse.json(updated);
}
