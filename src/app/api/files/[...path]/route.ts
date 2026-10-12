import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { isPrivateFolder, PRIVATE_BUCKET } from "@/lib/privateFiles";

// Abre un documento privado (ver src/lib/privateFiles.ts): solo con sesión de
// DAFLOW. Entrega un enlace firmado que vence en 10 minutos — si alguien
// reenvía o copia el enlace guardado, sin iniciar sesión no ve nada.
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const session = await auth();
  if (!session) {
    return new NextResponse("Inicia sesión en DAFLOW para ver este documento.", { status: 401, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const { path: parts } = await params;
  const path = parts.join("/");
  if (!isPrivateFolder(path) || parts.some((p) => p === ".." || p === "")) {
    return new NextResponse(null, { status: 404 });
  }
  const download = req.nextUrl.searchParams.get("download");
  const { data, error } = await supabaseAdmin()
    .storage.from(PRIVATE_BUCKET)
    .createSignedUrl(path, 600, download ? { download: parts[parts.length - 1] } : undefined);
  if (error || !data) return new NextResponse("No se encontró el documento.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const res = NextResponse.redirect(data.signedUrl, 302);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
