import Image from "next/image";

// Fotos de Supabase: optimizadas y en caché de Vercel (ver next.config.ts).
// Llegan como /pvx/f/… (publicPhotoUrl) para que no se vea "daflow".
// Cualquier otra dirección se muestra tal cual.
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

export function PvxPhoto({ src, alt, sizes, priority = false }: { src: string | null; alt: string; sizes: string; priority?: boolean }) {
  if (!src) return <div className="absolute inset-0 grid place-items-center bg-[#F4F4F2]"><Image src="/pvx/brand/mark-ink.png" alt="" width={360} height={403} className="w-[28%] max-w-[72px] h-auto opacity-[0.12]" /></div>;
  if (src.startsWith("/pvx/f/") || (SUPABASE && src.startsWith(`${SUPABASE}/storage/v1/object/public/`))) {
    return <Image src={src} alt={alt} fill sizes={sizes} priority={priority} className="object-cover" />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />;
}
