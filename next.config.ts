import type { NextConfig } from "next";

// Fotos de provedix.com (etapa 3, 2026-10-12): se piden a Supabase UNA vez y
// Vercel las guarda reducidas en caché — así muchas visitas no gastan el
// consumo de Supabase (ver bloqueo por egress, 2026-10-05).
const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  // Versión con la que se armó esta copia de la app, para compararla con la
  // publicada (ver AppVersionWatcher).
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
  },
  // Seguridad (pedido del usuario 2026-10-12): ninguna página de DAFLOW ni de
  // provedix.com se puede meter dentro de otra web (engaños tipo "página
  // falsa"); el navegador no adivina tipos de archivo; al salir a otra web no
  // se manda la dirección completa. Cámara (escáner) y micrófono (dictado)
  // solo para la propia app.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), browsing-topics=()" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: supabaseHost ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }] : [],
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
};

export default nextConfig;
