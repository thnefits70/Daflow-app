import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUnseenRecognitionForViewer } from "@/lib/recognitionCelebration";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ celebration: null });

  const viewerId = session.user.role === "admin" ? "admin" : session.user.id;
  const celebration = await getUnseenRecognitionForViewer(viewerId);

  return NextResponse.json({ celebration });
}
