import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/guards";
import { supabaseAdmin } from "@/lib/supabase";
import { CONFIDENTIAL_BUCKET, CONFIDENTIAL_MAX_BYTES, ensureConfidentialBucket } from "@/lib/confidentialDocs";

const signSchema = z.object({
  fileName: z.string().trim().min(1),
  size: z.number().int().nonnegative(),
});

// Mismo patrón que /api/upload/sign (confirmado 2026-07-25): el navegador
// sube el archivo directo a Supabase Storage con una URL firmada, sin pasar
// por esta función — así evitamos el límite de ~4.5 MB que Vercel impone al
// cuerpo de una solicitud, que aquí topaba aún más rápido dado que este es el
// bucket privado usado para archivos legales/RRHH.
export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = signSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const { fileName, size } = parsed.data;

  if (size > CONFIDENTIAL_MAX_BYTES) {
    return NextResponse.json({ error: "El archivo es muy pesado (máximo 15 MB)." }, { status: 400 });
  }

  const safeName = fileName.replace(/[^a-z0-9.\-_]/gi, "_");
  const path = `docs/${crypto.randomUUID()}-${safeName}`;

  try {
    await ensureConfidentialBucket();
    const supabase = supabaseAdmin();
    const { data, error } = await supabase.storage.from(CONFIDENTIAL_BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      return NextResponse.json(
        { error: `No se pudo iniciar la subida: ${error?.message ?? "error desconocido"}.` },
        { status: 500 }
      );
    }
    return NextResponse.json({ signedUrl: data.signedUrl, token: data.token, path, fileName });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "error desconocido";
    return NextResponse.json({ error: `No se pudo iniciar la subida: ${reason}.` }, { status: 500 });
  }
}
