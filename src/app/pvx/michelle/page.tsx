import type { Metadata } from "next";
import ProvedixPublicPage from "../page";

// provedix.com/michelle (2026-10-15): la misma página, con el chat de
// Michelle IA abierto, y su propio título e imagen al compartir.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Michelle IA, la asistente virtual de Provedix",
  description: "Pregúntale a Michelle IA por productos ganadores, el estado de tus guías y tus dudas sobre cómo vender con Provedix.",
  alternates: { canonical: "/michelle" },
  openGraph: {
    type: "website",
    url: "/michelle",
    siteName: "Provedix",
    locale: "es_EC",
    title: "Pregúntale a Michelle IA · Asistente virtual de Provedix",
    description: "Productos ganadores, el estado de tus guías y tus dudas sobre Provedix, al instante.",
  },
};

export default function Page() {
  return <ProvedixPublicPage />;
}
