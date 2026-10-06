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

// Confirmado 2026-08-14: bug real reportado por Bryan (con foto de su
// pantalla) — un corte de red durante el fetch a /api/upload/sign hacía que
// esta función RECHAZARA en vez de resolver con {ok:false}, así que el
// `await uploadFile(...)` del que llama nunca terminaba y el spinner de
// "subiendo" quedaba trabado para siempre, sin aviso y sin forma de
// reintentar. Se arregla acá, en la raíz — hay ~30 lugares en la app que
// llaman a esta función y todos esperan que SIEMPRE resuelva, nunca rechace.
// Confirmado 2026-09-14: signUrl opcional — el enlace público de CHEN
// (sin sesión) necesita su propia ruta de firma, que valida el token del
// proveedor en vez de auth(). Por defecto sigue siendo /api/upload/sign
// para los ~30 lugares que ya llaman a esta función.
export async function uploadFile(file: File, folder: string, signUrl: string = "/api/upload/sign"): Promise<UploadFileResult> {
  try {
    const signRes = await fetch(signUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, folder, size: file.size }),
    });
    if (!signRes.ok) {
      const data = await signRes.json().catch(() => null);
      return { ok: false, error: data?.error ?? "No se pudo iniciar la subida." };
    }
    const { token, path, publicUrl, fileName } = await signRes.json();

    // Confirmado 2026-09-29: Yair vio "Failed to fetch" subiendo el PDF de
    // guías de Dropi. Dos causas típicas: (1) el navegador lee el archivo del
    // disco recién al enviarlo — si el PDF se acaba de descargar o Windows lo
    // sigue tocando, Chrome corta la subida; (2) un microcorte de internet.
    // Se copia el archivo a memoria antes de enviarlo y se reintenta hasta 3
    // veces si la red falla.
    let body: File;
    try {
      body = new File([await file.arrayBuffer()], file.name, { type: file.type });
    } catch {
      return { ok: false, error: `No se pudo leer "${file.name}" — si lo acabas de descargar, espera a que termine y vuelve a elegirlo.` };
    }

    const supabase = getBrowserSupabase();
    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
      try {
        // Cada archivo tiene nombre único y nunca cambia: el navegador lo
        // guarda un año y no lo vuelve a descargar (2026-10-06, para bajar el
        // consumo de datos de Supabase).
        const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, body, { cacheControl: "31536000" });
        if (!error) {
          lastError = "";
          break;
        }
        // Si el intento anterior sí llegó pero se perdió la respuesta, el
        // archivo ya está guardado — eso cuenta como subido.
        if (attempt > 0 && /exists|duplicate/i.test(error.message)) {
          lastError = "";
          break;
        }
        lastError = error.message;
        if (!/fetch|network|load failed|timeout/i.test(error.message)) break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : "error de red";
      }
    }
    if (lastError) {
      return { ok: false, error: `No se pudo subir el archivo (${lastError}) — se intentó 3 veces. Revisa tu internet e intenta de nuevo.` };
    }
    // Fallback to signedUrl-derived data in case the server response shape
    // ever changes — publicUrl/fileName always come from the sign step.
    return { ok: true, url: publicUrl, name: fileName ?? file.name };
  } catch {
    return { ok: false, error: "No se pudo subir el archivo — revisa tu conexión e intenta de nuevo." };
  }
}
