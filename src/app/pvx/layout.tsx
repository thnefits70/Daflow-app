import type { Metadata } from "next";

// provedix.com (etapa 3, 2026-10-12): título e ícono propios — nada de DAFLOW.
export const metadata: Metadata = {
  title: "Provedix · Productos ganadores con datos reales de venta",
  description:
    "Descubre gratis qué productos de nuestras bodegas se están vendiendo en Ecuador: ventas, precio al público, ciudades y combos, con datos reales de despacho.",
  robots: { index: true, follow: true },
};

export default function PvxLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#f6f5f2] text-[#16181d]">{children}</div>;
}
