// Igual que src/lib/uploadFile.ts pero para el bucket privado de Documentos
// Confidenciales — no hay URL pública que devolver (el archivo solo se lee
// después vía una signed URL de corta duración, ver /api/confidential-documents/[id]/view).
import { createClient } from "@supabase/supabase-js";

const BUCKET = "daflow-confidential";

let browserClient: ReturnType<typeof createClient> | null = null;
function getBrowserSupabase() {
  if (!browserClient) {
    browserClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );
  }
  return browserClient;
}

export type UploadConfidentialFileResult =
  | { ok: true; storagePath: string; fileName: string }
  | { ok: false; error: string };

export async function uploadConfidentialFile(file: File): Promise<UploadConfidentialFileResult> {
  const signRes = await fetch("/api/confidential-documents/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, size: file.size }),
  });
  if (!signRes.ok) {
    const data = await signRes.json().catch(() => null);
    return { ok: false, error: data?.error ?? "No se pudo iniciar la subida." };
  }
  const { token, path, fileName } = await signRes.json();

  const supabase = getBrowserSupabase();
  const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, file);
  if (error) {
    return { ok: false, error: `No se pudo subir el archivo: ${error.message}. Intenta de nuevo o con otro archivo.` };
  }
  return { ok: true, storagePath: path, fileName: fileName ?? file.name };
}
