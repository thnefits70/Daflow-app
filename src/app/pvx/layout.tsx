import type { Metadata, Viewport } from "next";
import { Saira } from "next/font/google";
import "./pvx.css";

// Letra de provedix.com (rediseño 2026-10-13): Saira, ancha, gruesa e
// inclinada como las letras del logo de Provedix (ficha técnica: sans serif
// geométrica, extendida, Black, oblicua ~10°). Variable en ancho y peso.
const saira = Saira({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  axes: ["wdth"],
  variable: "--font-pvx",
  display: "swap",
});

// provedix.com (etapa 3, 2026-10-12): título e ícono propios — nada de DAFLOW.
export const metadata: Metadata = {
  // Dirección oficial para Google (2026-10-13): aunque la página también se
  // abra desde otro dominio, Google la registra solo como provedix.com.
  metadataBase: new URL("https://provedix.com"),
  alternates: { canonical: "/" },
  applicationName: "Provedix",
  keywords: ["Provedix", "proveedor Dropi Ecuador", "dropshipping Ecuador", "productos ganadores", "proveedor dropshipping Guayaquil"],
  title: "Provedix | Proveedor de Dropi en Ecuador · Productos ganadores",
  description:
    "Provedix es proveedor verificado de Dropi en Ecuador. Mira gratis qué productos se están vendiendo, a qué precio y en qué ciudades. Más de 3 cortes diarios y despacho en menos de 3 horas.",
  robots: { index: true, follow: true },
  // Logo oficial de Provedix (2026-10-12): el layout raíz pone el favicon
  // de DAFLOW (platformSettings.faviconUrl); definir `icons` acá lo tapa,
  // igual que en proveedor-ledger. Vive en public/pvx/ porque en
  // provedix.com el proxy solo deja pasar rutas que empiezan con /pvx.
  icons: {
    icon: { url: "/pvx/icon.png", type: "image/png", sizes: "512x512" },
    shortcut: "/pvx/icon.png",
    apple: "/pvx/apple-icon.png",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Provedix",
    locale: "es_EC",
    title: "Provedix | Proveedor de Dropi en Ecuador",
    description: "Mira gratis qué productos se están vendiendo en Ecuador y véndelos en Dropi. Despacho en menos de 3 horas.",
    images: [{ url: "/pvx/brand/stacked-orange.png", width: 900, height: 581 }],
  },
};

export const viewport: Viewport = { themeColor: "#0d0e11" };

export default function PvxLayout({ children }: { children: React.ReactNode }) {
  return <div className={`pvx ${saira.variable} min-h-screen`}>{children}</div>;
}
