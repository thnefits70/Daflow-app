import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { approvePriceCorrection, rejectPriceCorrection } from "@/lib/purchasePriceCorrection";

const schema = z.object({ action: z.enum(["approve", "reject"]), rejectReason: z.string().trim().optional() });

// Confirmado 2026-09-29: cambiar el precio de una compra ya aprobada es
// exclusivo del admin — nunca lo aplica quien lo pide.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user.role !== "admin") return NextResponse.json({ error: "Solo el admin aprueba correcciones de precio." }, { status: 403 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const existing = await prisma.purchasePriceCorrection.findUnique({ where: { id }, select: { requestedById: true } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  try {
    if (parsed.data.action === "reject") {
      const rejected = await rejectPriceCorrection(id, parsed.data.rejectReason ?? "");
      if (existing.requestedById) {
        await notifyOwner(existing.requestedById, {
          title: "Corrección de precio rechazada",
          body: `${rejected.request.catalogItem.name}: ${rejected.rejectReason}`,
          url: "/area/workspace",
        }).catch(() => null);
      }
      return NextResponse.json({ ok: true });
    }
    const result = await approvePriceCorrection(id);
    if (existing.requestedById) {
      await notifyOwner(existing.requestedById, {
        title: "Corrección de precio aprobada",
        body: `${result.productName}: ahora $${result.newUnitCost.toFixed(2)} por unidad (antes $${result.oldUnitCost.toFixed(2)}).`,
        url: "/area/workspace",
      }).catch(() => null);
    }
    return NextResponse.json({ ok: true, kardexUnits: result.kardexUnits });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo revisar." }, { status: 409 });
  }
}
