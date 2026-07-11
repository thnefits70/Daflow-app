import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/guards";
import { supabaseAdmin } from "@/lib/supabase";

const BUCKET = "daflow-files";
const MAX_BYTES = 15 * 1024 * 1024;

async function ensureBucket() {
  const supabase = supabaseAdmin();
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((b) => b.name === BUCKET)) return;
  await supabase.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES });
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  const folder = (formData?.get("folder") as string) || "misc";
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No se recibió ningún archivo." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "El archivo es muy pesado (máximo 15 MB)." }, { status: 400 });
  }

  const safeFolder = folder.replace(/[^a-z0-9-]/gi, "_");
  const safeName = file.name.replace(/[^a-z0-9.\-_]/gi, "_");
  const path = `${safeFolder}/${crypto.randomUUID()}-${safeName}`;

  await ensureBucket();
  const supabase = supabaseAdmin();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) {
    return NextResponse.json({ error: "No se pudo subir el archivo." }, { status: 500 });
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl, name: file.name });
}
