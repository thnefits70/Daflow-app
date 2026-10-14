"use client";

import { SessionProvider } from "next-auth/react";
import { GlobalImageZoom } from "@/components/shared/GlobalImageZoom";
import { GlobalNumberInputGuard } from "@/components/shared/GlobalNumberInputGuard";
import { ThemeAutoSwitch } from "@/components/shared/ThemeToggle";
import { SoundUnlock } from "@/components/shared/SoundToggle";
import { AppVersionWatcher } from "@/components/shared/AppVersionWatcher";

// publicSite: provedix.com (2026-10-14). La página pública no carga la sesión
// ni las herramientas internas de DAFLOW: así no pide /api/auth/session ni
// /api/app-version, y no queda ningún rastro de DAFLOW en el navegador.
export function Providers({ children, publicSite = false }: { children: React.ReactNode; publicSite?: boolean }) {
  if (publicSite) return <>{children}</>;
  return (
    <SessionProvider>
      {children}
      <GlobalImageZoom />
      <GlobalNumberInputGuard />
      <ThemeAutoSwitch />
      <SoundUnlock />
      <AppVersionWatcher />
    </SessionProvider>
  );
}
