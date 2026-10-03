"use client";

import { SessionProvider } from "next-auth/react";
import { GlobalImageZoom } from "@/components/shared/GlobalImageZoom";
import { GlobalNumberInputGuard } from "@/components/shared/GlobalNumberInputGuard";
import { ThemeAutoSwitch } from "@/components/shared/ThemeToggle";
import { SoundUnlock } from "@/components/shared/SoundToggle";
import { AppVersionWatcher } from "@/components/shared/AppVersionWatcher";

export function Providers({ children }: { children: React.ReactNode }) {
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
