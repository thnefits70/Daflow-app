import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUnseenCelebrantsForViewer } from "@/lib/birthdays";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ celebrants: [] });

  const viewerId = session.user.role === "admin" ? "admin" : session.user.id;
  const celebrants = await getUnseenCelebrantsForViewer(viewerId);

  return NextResponse.json({ celebrants });
}
