import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Versión con la que se armó esta copia de la app, para compararla con la
  // publicada (ver AppVersionWatcher).
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
  },
};

export default nextConfig;
