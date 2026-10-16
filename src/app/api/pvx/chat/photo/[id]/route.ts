import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchStoredFile } from "@/lib/privateFiles";
import { hitAllowed, readVisitor, tooMany } from "@/lib/provedixVisitor";

// Foto de evidencia de una guía retenida (2026-10-15): solo la ve el dueño
// del chat donde se pidió la cancelación (mismo navegador o mismo registro).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Límite contra bots (2026-10-16): 30 fotos por minuto por conexión.
  if (!hitAllowed(req, "photo", 30, 60_000)) return tooMany();
  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/i.test(id))
    return new NextResponse(null, { status: 404 });
  const { visitorId, leadId } = await readVisitor(req);
  const r = await prisma.cancelledGuideReport.findUnique({
    where: { id },
    select: { retainedPhotoUrl: true, michelleChatId: true },
  });
  if (!r?.retainedPhotoUrl || !r.michelleChatId)
    return new NextResponse(null, { status: 404 });
  const chat = await prisma.provedixChat.findFirst({
    where: {
      id: r.michelleChatId,
      OR: leadId ? [{ visitorId }, { leadId }] : [{ visitorId }],
    },
    select: { id: true },
  });
  if (!chat) return new NextResponse(null, { status: 404 });
  const file = await fetchStoredFile(r.retainedPhotoUrl);
  if (!file.ok) return new NextResponse(null, { status: 404 });
  return new NextResponse(file.body, {
    headers: {
      "Content-Type": file.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
