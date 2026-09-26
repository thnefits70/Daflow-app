"use client";

import { SessionProvider } from "next-auth/react";
import { GlobalImageZoom } from "@/components/shared/GlobalImageZoom";
import { GlobalNumberInputGuard } from "@/components/shared/GlobalNumberInputGuard";
import { ThemeAutoSwitch } from "@/components/shared/ThemeToggle";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <GlobalImageZoom />
      <GlobalNumberInputGuard />
      <ThemeAutoSwitch />
    </SessionProvider>
  );
}
