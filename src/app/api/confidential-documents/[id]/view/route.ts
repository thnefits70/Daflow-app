import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { CONFIDENTIAL_BUCKET } from "@/lib/confidentialDocs";

// Never returns the file directly or a lasting URL — only a signed link that
// expires in seconds, and only after confirming this exact user is allowed
// to see this exact document (admin, or an explicit grant).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { id } = await params;

  const doc = await prisma.confidentialDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  if (session.user.role !== "admin") {
    const grant = await prisma.confidentialDocumentAccess.findUnique({
      where: { documentId_userId: { documentId: id, userId: session.user.id } },
    });
    if (!grant) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    if (!grant.seenAt) {
      await prisma.confidentialDocumentAccess.update({ where: { id: grant.id }, data: { seenAt: new Date() } });
    }
  }

  const { data, error } = await supabaseAdmin().storage.from(CONFIDENTIAL_BUCKET).createSignedUrl(doc.storagePath, 60);
  if (error || !data) return NextResponse.json({ error: "No se pudo generar el enlace." }, { status: 500 });

  return NextResponse.redirect(data.signedUrl);
}
