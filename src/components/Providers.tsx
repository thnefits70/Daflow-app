"use client";

import { SessionProvider } from "next-auth/react";
import { GlobalImageZoom } from "@/components/shared/GlobalImageZoom";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <GlobalImageZoom />
    </SessionProvider>
  );
}
