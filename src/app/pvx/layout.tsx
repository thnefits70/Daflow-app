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
  title: "Provedix · Productos ganadores con datos reales de venta",
  description:
    "Descubre gratis qué productos de nuestras bodegas se están vendiendo en Ecuador: ventas, precio al público, ciudades y combos, con datos reales de despacho.",
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
    title: "Provedix · Productos ganadores con datos reales de venta",
    description: "Mira gratis qué se está vendiendo en Ecuador y véndelo en Dropi.",
    images: [{ url: "/pvx/brand/stacked-orange.png", width: 900, height: 581 }],
  },
};

export const viewport: Viewport = { themeColor: "#0d0e11" };

export default function PvxLayout({ children }: { children: React.ReactNode }) {
  return <div className={`pvx ${saira.variable} min-h-screen`}>{children}</div>;
}
