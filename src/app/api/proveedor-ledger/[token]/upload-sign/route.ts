import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";

// Confirmado 2026-09-15 (foto opcional de CHEN en su enlace público): esta
// página no tiene auth() a propósito — el proveedor de crédito entra solo
// con el token de su enlace, sin usuario ni contraseña. La ruta general
// /api/upload/sign no se puede reutilizar porque es enteramente por sesión
// (auth()); acá el token hace el mismo papel, validado igual que en
// page.tsx: sha256(token) -> Supplier.publicLedgerTokenHash ->
// paymentMode==="CREDITO". Carpeta fija, no la manda el cliente.
const BUCKET = "daflow-files";
const MAX_BYTES = 50 * 1024 * 1024;
const FOLDER = "supplier-shipping-photos";

async function ensureBucket() {
  const supabase = supabaseAdmin();
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((b) => b.name === BUCKET)) {
    await supabase.storage.updateBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES });
    return;
  }
  await supabase.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES });
}

const signSchema = z.object({
  fileName: z.string().trim().min(1),
  size: z.number().int().nonnegative(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const supplier = await prisma.supplier.findUnique({ where: { publicLedgerTokenHash: tokenHash } });
  if (!supplier || supplier.paymentMode !== "CREDITO") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = signSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const { fileName, size } = parsed.data;
  if (size > MAX_BYTES) {
    return NextResponse.json({ error: "El archivo es muy pesado (máximo 50 MB)." }, { status: 400 });
  }

  const safeName = fileName.replace(/[^a-z0-9.\-_]/gi, "_");
  const path = `${FOLDER}/${crypto.randomUUID()}-${safeName}`;

  try {
    await ensureBucket();
    const supabase = supabaseAdmin();
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      console.error("[proveedor-ledger/upload-sign] Supabase error:", error);
      return NextResponse.json(
        { error: `No se pudo iniciar la subida: ${error?.message ?? "error desconocido"}.` },
        { status: 500 }
      );
    }

    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({
      signedUrl: data.signedUrl,
      token: data.token,
      path,
      publicUrl: publicData.publicUrl,
      fileName,
    });
  } catch (err) {
    console.error("[proveedor-ledger/upload-sign] unexpected error:", err);
    const reason = err instanceof Error ? err.message : "error desconocido";
    return NextResponse.json({ error: `No se pudo iniciar la subida: ${reason}.` }, { status: 500 });
  }
}
