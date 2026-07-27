import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/guards";
import { searchContentOptions } from "@/lib/learningPaths";

export async function GET(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const options = await searchContentOptions(q);
  return NextResponse.json(options);
}
