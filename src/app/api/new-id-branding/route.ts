import { NextResponse } from "next/server";
import { canViewMarketingArrivals } from "@/lib/guards";
import { canBrandNewIds, getNewIdBrandingBoard } from "@/lib/newIdBranding";

export async function GET() {
  if (!(await canViewMarketingArrivals())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const [board, canAct] = await Promise.all([getNewIdBrandingBoard(), canBrandNewIds()]);
  return NextResponse.json({ ...board, canAct });
}
