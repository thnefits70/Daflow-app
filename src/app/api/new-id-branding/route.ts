import { NextResponse } from "next/server";
import { canViewMarketingArrivals } from "@/lib/guards";
import { canBrandNewIds, canViewFinishedNewIdsOnly, getNewIdBrandingBoard } from "@/lib/newIdBranding";

export async function GET() {
  if (await canViewMarketingArrivals()) {
    const [board, canAct] = await Promise.all([getNewIdBrandingBoard(), canBrandNewIds()]);
    return NextResponse.json({ ...board, canAct, finishedOnly: false });
  }
  // Marcos: solo lo terminado por completo (brandeo + imágenes reales).
  if (await canViewFinishedNewIdsOnly()) {
    const board = await getNewIdBrandingBoard();
    return NextResponse.json({ pending: [], realPhotos: [], done: board.done.filter((e) => e.realPhotos), canAct: false, finishedOnly: true });
  }
  return NextResponse.json({ error: "No autorizado." }, { status: 403 });
}
