import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getLatestPodium } from "@/lib/recognitionCelebration";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ result: null });

  const result = await getLatestPodium();
  return NextResponse.json({ result });
}
