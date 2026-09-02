"use client";

import { SessionProvider } from "next-auth/react";
import { GlobalImageZoom } from "@/components/shared/GlobalImageZoom";
import { GlobalNumberInputGuard } from "@/components/shared/GlobalNumberInputGuard";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <GlobalImageZoom />
      <GlobalNumberInputGuard />
    </SessionProvider>
  );
}
