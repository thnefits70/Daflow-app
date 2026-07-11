import { createClient } from "@supabase/supabase-js";

// Server-side client with the service role key — bypasses RLS, only ever
// imported from server code (route handlers, server actions). Used for
// uploading/reading files in Supabase Storage (photos, CVs, PDFs, logo).
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
