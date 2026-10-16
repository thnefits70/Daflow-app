"use client";

import { SessionProvider } from "next-auth/react";
import { useSelectedLayoutSegment } from "next/navigation";
import { GlobalImageZoom } from "@/components/shared/GlobalImageZoom";
import { GlobalNumberInputGuard } from "@/components/shared/GlobalNumberInputGuard";
import { ThemeAutoSwitch } from "@/components/shared/ThemeToggle";
import { SoundUnlock } from "@/components/shared/SoundToggle";
import { AppVersionWatcher } from "@/components/shared/AppVersionWatcher";

// publicSite: provedix.com (2026-10-14). La página pública no carga la sesión
// ni las herramientas internas de DAFLOW: así no pide /api/auth/session ni
// /api/app-version, y no queda ningún rastro de DAFLOW en el navegador.
// 2026-10-17: se sabe por la ruta (/pvx…, que es lo único que sirve
// provedix.com) y no por el dominio: así el layout raíz no lee los
// encabezados y la página pública puede servirse ya armada desde la red de
// Vercel (sin despertar al servidor). Mismo resultado en el navegador.
export function Providers({ children, publicSite = false }: { children: React.ReactNode; publicSite?: boolean }) {
  const segment = useSelectedLayoutSegment();
  if (publicSite || segment === "pvx") return <>{children}</>;
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
