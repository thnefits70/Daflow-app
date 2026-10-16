import type { Metadata } from "next";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { prisma } from "@/lib/prisma";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  // Sin precarga (2026-10-17): provedix.com no usa estas letras y no debe bajarlas.
  preload: false,
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  // Sin precarga (2026-10-17): provedix.com no usa estas letras y no debe bajarlas.
  preload: false,
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  // Sin precarga (2026-10-17): provedix.com no usa estas letras y no debe bajarlas.
  preload: false,
  subsets: ["latin"],
  weight: ["500", "600"],
});

// provedix.com pone su propio título, descripción e ícono en src/app/pvx/layout.tsx
// (que reemplazan a estos). Desde 2026-10-17 aquí no se lee el dominio (eso
// volvía dinámica cada página, también la pública); la página de un proveedor
// (dunxingchen.cc) sigue con su not-found.tsx propio.
export async function generateMetadata(): Promise<Metadata> {
  const settings = await prisma.platformSettings.findUnique({ where: { id: "singleton" } }).catch(() => null);
  return {
    title: "DAFLOW — Process Standardization Platform",
    description: "Plataforma interna de gestión de procesos.",
    icons: settings?.faviconUrl ? { icon: settings.faviconUrl } : undefined,
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${spaceGrotesk.variable} ${inter.variable} ${plexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
