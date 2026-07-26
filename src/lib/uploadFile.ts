// Client-side upload helper — confirmed 2026-07-25. Uploads go directly from
// the browser to Supabase Storage using a signed URL from /api/upload/sign,
// instead of through our own Next.js route handler. This avoids Vercel's
// ~4.5 MB request body limit on serverless functions, which was silently
// capping uploads well below the 15 MB our own code allowed.
import { createClient } from "@supabase/supabase-js";

// Must match BUCKET in src/app/api/upload/sign/route.ts.
const BUCKET = "daflow-files";

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

// A literal `ok` discriminant (not an optional `error?: string`) so
// TypeScript can actually narrow the union — a plain `string` field can't be
// used for truthy/falsy narrowing since "" is a valid (falsy) string.
export type UploadFileResult = { ok: true; url: string; name: string } | { ok: false; error: string };

export async function uploadFile(file: File, folder: string): Promise<UploadFileResult> {
  const signRes = await fetch("/api/upload/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, folder, size: file.size }),
  });
  if (!signRes.ok) {
    const data = await signRes.json().catch(() => null);
    return { ok: false, error: data?.error ?? "No se pudo iniciar la subida." };
  }
  const { token, path, publicUrl, fileName } = await signRes.json();

  const supabase = getBrowserSupabase();
  const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, file);
  if (error) {
    return { ok: false, error: `No se pudo subir el archivo: ${error.message}. Intenta de nuevo o con otro archivo.` };
  }
  // Fallback to signedUrl-derived data in case the server response shape
  // ever changes — publicUrl/fileName always come from the sign step.
  return { ok: true, url: publicUrl, name: fileName ?? file.name };
}
