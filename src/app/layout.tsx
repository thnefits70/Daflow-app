import type { Metadata } from "next";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { prisma } from "@/lib/prisma";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { headers } from "next/headers";
import { isProvedixHost } from "@/lib/provedixHosts";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export async function generateMetadata(): Promise<Metadata> {
  // provedix.com (2026-10-12, pedido del usuario: que nadie sepa que está
  // conectado con DAFLOW): cualquier 404 de ese dominio (/favicon.ico,
  // /pvx/loquesea) se pintaba con este layout y mostraba "DAFLOW" en el
  // título, la descripción y el ícono de Supabase "daflow-files".
  const host = (await headers()).get("host")?.split(":")[0];
  if (isProvedixHost(host)) {
    return {
      title: "Provedix",
      icons: { icon: { url: "/pvx/icon.png", type: "image/png" }, apple: "/pvx/apple-icon.png" },
    };
  }
  const settings = await prisma.platformSettings.findUnique({ where: { id: "singleton" } });
  return {
    title: "DAFLOW — Process Standardization Platform",
    description: "Plataforma interna de gestión de procesos.",
    icons: settings?.faviconUrl ? { icon: settings.faviconUrl } : undefined,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const host = (await headers()).get("host")?.split(":")[0];
  const publicSite = isProvedixHost(host);
  return (
    <html
      lang="es"
      className={publicSite ? "h-full antialiased" : `${spaceGrotesk.variable} ${inter.variable} ${plexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <Providers publicSite={publicSite}>{children}</Providers>
      </body>
    </html>
  );
}
