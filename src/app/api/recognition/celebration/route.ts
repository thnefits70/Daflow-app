import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUnseenRecognitionsForViewer } from "@/lib/recognitionCelebration";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ celebrations: [] });

  const viewerId = session.user.role === "admin" ? "admin" : session.user.id;
  const celebrations = await getUnseenRecognitionsForViewer(viewerId);

  return NextResponse.json({ celebrations });
}
