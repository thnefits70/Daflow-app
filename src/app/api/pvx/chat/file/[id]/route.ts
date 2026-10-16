import { NextRequest, NextResponse } from "next/server";
import { ATTACH_FOLDER, signedViewPath } from "@/lib/provedixAttachments";
import { chatVisitor, ownChatIds } from "@/lib/provedixChatAccess";
import { hitAllowed, tooMany } from "@/lib/provedixVisitor";

// Ver una foto o video adjunto en el chat (2026-10-16): solo el dueño del
// chat. Manda a /pvx/dl/… (next.config.ts) con un enlace firmado de 10 minutos.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!hitAllowed(req, "attachview", 60, 60_000)) return tooMany();
  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/i.test(id)) return new NextResponse(null, { status: 404 });
  const { visitorId, leadId } = await chatVisitor(req);
  const signed = await signedViewPath(id, await ownChatIds(visitorId, leadId));
  if (!signed) return new NextResponse(null, { status: 404 });
  const rest = signed.path.slice(ATTACH_FOLDER.length + 1);
  const res = NextResponse.redirect(new URL(`/pvx/dl/${rest}?token=${encodeURIComponent(signed.token)}`, req.nextUrl), 302);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
