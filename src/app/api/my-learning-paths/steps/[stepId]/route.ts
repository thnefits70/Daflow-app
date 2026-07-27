import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getStepForTaking } from "@/lib/learningPaths";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ stepId: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "employee") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { stepId } = await params;
  try {
    const data = await getStepForTaking(session.user.id, stepId);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo cargar el paso.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
