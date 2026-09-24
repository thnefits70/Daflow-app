import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  canActOnPurchaseApproval,
  canConfirmPurchaseReceiving,
  canManageOutflowPurchaseGestion,
  canSubmitPurchaseRequests,
} from "@/lib/guards";
import { getOrderSummary } from "@/lib/supplierSheetAuto";
import { formatPurchaseRequestCode } from "@/lib/purchases";

// Confirmado 2026-09-24, pedido explícito del usuario: las notas que escribe
// la gente de CHEN en la hoja, dentro de DAFLOW (Control de Compras → "Notas
// de Chen"), cada una con el pedido al que pertenece y su estado actual — así
// nadie tiene que buscar ni recordar a qué pedido se refiere. Por defecto
// cada quien ve las que le avisaron a él; "Todas" muestra el resto.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const isAdmin = session.user.role === "admin";
  if (!isAdmin) {
    const allowed =
      (await canSubmitPurchaseRequests()) ||
      (await canConfirmPurchaseReceiving()) ||
      (await canManageOutflowPurchaseGestion()) ||
      (await canActOnPurchaseApproval());
    if (!allowed) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const me = isAdmin ? "admin" : session.user.id;
  const all = req.nextUrl.searchParams.get("all") === "1";

  const notes = await prisma.supplierSheetNote.findMany({
    where: all ? {} : { notifiedTo: { has: me } },
    orderBy: { updatedAt: "desc" },
    take: 150,
  });

  const userIds = [...new Set(notes.flatMap((n) => n.notifiedTo).filter((id) => id !== "admin"))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  const rows = await Promise.all(
    notes.map(async (n) => {
      const order = n.requestId ? await getOrderSummary(n.supplierId, n.requestId) : null;
      return {
        id: n.id,
        text: n.text,
        authorEmail: n.authorEmail,
        tabName: n.tabName,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        clearedAt: n.clearedAt,
        forMe: n.notifiedTo.includes(me),
        notifiedToNames: n.notifiedTo.map((id) => (id === "admin" ? "Administración" : (nameOf.get(id) ?? "—"))),
        routeMethod: n.routeMethod,
        routeReason: n.routeReason,
        isPayment: !!n.debtPaymentId,
        order: order
          ? {
              code: order.requestNumber != null ? formatPurchaseRequestCode(order.requestNumber) : null,
              productName: order.productName,
              photoUrl: order.photoUrl,
              quantity: order.quantity,
              requestedAt: order.requestedAt,
              statusText: order.statusText,
              statusTone: order.statusTone,
              paymentText: order.paymentText,
            }
          : null,
      };
    }),
  );
  return NextResponse.json({ notes: rows, isAdmin });
}
