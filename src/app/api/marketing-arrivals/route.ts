import { NextResponse } from "next/server";
import { canViewMarketingArrivals } from "@/lib/guards";
import { getMarketingArrivals, getMarketingArrivalConfirmers } from "@/lib/marketingArrivals";

export async function GET() {
  if (!(await canViewMarketingArrivals())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const [rows, confirmers] = await Promise.all([getMarketingArrivals(), getMarketingArrivalConfirmers()]);
  return NextResponse.json({ rows, confirmers });
}
