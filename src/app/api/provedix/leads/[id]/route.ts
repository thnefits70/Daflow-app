import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getProvedixLeadActivity } from "@/lib/provedixTraffic";

// Historial de un dropshipper de la cartera — SOLO el admin (decisión del
// usuario 2026-10-12).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  return NextResponse.json(await getProvedixLeadActivity(id));
}
