import { supabaseAdmin } from "@/lib/supabase";

// Private bucket — never created with public:true. Files here have no public
// URL; every view goes through a short-lived signed URL generated on demand.
export const CONFIDENTIAL_BUCKET = "daflow-confidential";
export const CONFIDENTIAL_MAX_BYTES = 15 * 1024 * 1024;

export async function ensureConfidentialBucket() {
  const supabase = supabaseAdmin();
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((b) => b.name === CONFIDENTIAL_BUCKET)) return;
  await supabase.storage.createBucket(CONFIDENTIAL_BUCKET, { public: false, fileSizeLimit: CONFIDENTIAL_MAX_BYTES });
}
