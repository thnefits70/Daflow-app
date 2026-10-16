import Image from "next/image";

// Fotos de Supabase: optimizadas y en caché de Vercel (ver next.config.ts).
// Llegan como /pvx/f/… (publicPhotoUrl) para que no se vea "daflow" ni la
// dirección del almacenamiento (2026-10-14: ya no va en el código que baja el
// visitante). Cualquier otra dirección se muestra tal cual.

// fit="contain": la foto completa, sin recortar (ficha del producto, 2026-10-14).
export function PvxPhoto({ src, alt, sizes, priority = false, fit = "cover" }: { src: string | null; alt: string; sizes: string; priority?: boolean; fit?: "cover" | "contain" }) {
  const fitClass = fit === "contain" ? "object-contain" : "object-cover";
  if (!src) return <div className="absolute inset-0 grid place-items-center bg-[#F4F4F2]"><Image src="/pvx/brand/mark-ink.png" alt="" width={360} height={403} className="w-[28%] max-w-[72px] h-auto opacity-[0.12]" /></div>;
  if (src.startsWith("/pvx/f/")) {
    return <Image src={src} alt={alt} fill sizes={sizes} priority={priority} className={fitClass} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" className={`absolute inset-0 w-full h-full ${fitClass}`} />;
}

// Texto de la foto de un producto (2026-10-16): para Google Imágenes y para
// quien usa lector de pantalla. Donde el nombre ya está escrito al lado, la
// foto lleva alt="" (no se repite).
export function productAlt(name: string): string {
  return `${name}, producto ganador de Provedix para vender en Dropi en Ecuador`;
}
