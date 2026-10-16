import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";
import { ATTACH_BUCKET } from "@/lib/provedixAttachments";
import { getCasesRole } from "@/lib/provedixCases";

// Foto o video que el dropshipper adjuntó en el chat (2026-10-16), para quien
// atiende el caso: solo si ese chat tiene un caso de su plataforma (o admin).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = await getCasesRole();
  if (!role) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/i.test(id)) return new NextResponse(null, { status: 404 });
  const row = await prisma.provedixChatAttachment.findFirst({
    where: { id, done: true, chat: { cases: { some: { platform: { in: role.platforms } } } } },
    select: { path: true },
  });
  if (!row) return new NextResponse(null, { status: 404 });
  const { data } = await supabaseAdmin().storage.from(ATTACH_BUCKET).createSignedUrl(row.path, 600);
  if (!data?.signedUrl) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(data.signedUrl, 302);
}
