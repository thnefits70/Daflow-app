import { NextResponse } from "next/server";
import { canViewMarketingArrivals } from "@/lib/guards";
import { getMarketingArrivals } from "@/lib/marketingArrivals";

export async function GET() {
  if (!(await canViewMarketingArrivals())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const rows = await getMarketingArrivals();
  return NextResponse.json(rows);
}
