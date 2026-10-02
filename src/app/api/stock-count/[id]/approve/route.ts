import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dbUserId, getInventoryLeadId, requireAdminSession } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { approveDifferences } from "@/lib/stockCount";

const schema = z.object({ approveLineIds: z.array(z.string()).max(2000) });

// El admin aprueba la lista de diferencias de una vez (las que desmarcó
// quedan rechazadas y no tocan el stock).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const { id } = await params;
  const r = await approveDifferences({ countId: id, approveLineIds: parsed.data.approveLineIds, adminId: dbUserId(session.user.id) });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  const danielId = await getInventoryLeadId();
  if (danielId) {
    await notifyOwner(danielId, {
      title: "✅ Conteo físico aprobado",
      body: `Se ajustaron ${r.applied} producto(s)${r.rejected ? ` y ${r.rejected} se rechazaron` : ""}. El stock ya refleja lo contado.`,
      url: "/area/conteo-inventario",
    }).catch(() => null);
  }
  return NextResponse.json(r);
}
