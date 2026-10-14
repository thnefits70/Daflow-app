import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getProvedixChatMessages } from "@/lib/provedixTraffic";

// Una conversación con Michelle (asistente virtual de provedix.com) — SOLO el admin.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  return NextResponse.json(await getProvedixChatMessages(id));
}
