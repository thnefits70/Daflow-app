import { NextRequest, NextResponse } from "next/server";
import { getRepurchaseAccess } from "@/lib/repurchaseAccess";
import { searchRepurchaseItems } from "@/lib/repurchaseReviews";

// Solo productos que ya estuvieron en bodega o ya se compraron (recompras).
export async function GET(req: NextRequest) {
  const access = await getRepurchaseAccess();
  if (!access?.canView) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  return NextResponse.json(await searchRepurchaseItems(req.nextUrl.searchParams.get("q") ?? ""));
}
