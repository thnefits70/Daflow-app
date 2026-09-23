import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canSubmitFulfillmentRequest } from "@/lib/guards";

// "Volver a incluir" un código que se había marcado como "no es producto"
// (ver DropiIgnoredCode) — por si alguien lo marcó por error.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!(await canSubmitFulfillmentRequest())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { code } = await params;
  await prisma.dropiIgnoredCode.deleteMany({ where: { code: decodeURIComponent(code) } });
  return NextResponse.json({ ok: true });
}
