import type { Metadata } from "next";
import ProvedixPublicPage from "../page";

// provedix.com/calculadora (2026-10-15): la misma página, que abre directo en
// la calculadora, con su propio título e imagen al compartir.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Calculadora de ganancia gratis | Provedix",
  description: "¿A cuánto vender tu producto para ganar? Calcula tu precio rentable, cuánto puedes pagar de publicidad y tus combos. Gratis, de Provedix.",
  alternates: { canonical: "/calculadora" },
  openGraph: {
    type: "website",
    url: "/calculadora",
    siteName: "Provedix",
    locale: "es_EC",
    title: "¿A cuánto lo vendo para ganar? · Calculadora gratis de Provedix",
    description: "Tu precio rentable, cuánto puedes pagar de publicidad y tus combos, en segundos.",
  },
};

export default function Page() {
  return <ProvedixPublicPage />;
}
