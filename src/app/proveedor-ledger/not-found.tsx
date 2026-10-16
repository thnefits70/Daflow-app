import type { Metadata } from "next";

// "No encontrado" de las páginas del proveedor (dunxingchen.cc), 2026-10-17:
// antes lo resolvía el not-found raíz mirando el dominio, pero eso volvía
// dinámicas TODAS las páginas de la app (también provedix.com). Aquí, dentro
// de su propia sección, se ve sin rastro de DAFLOW: sin título ni ícono.
export const metadata: Metadata = {
  title: "No encontrado",
  description: "",
  icons: { icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" },
};

export default function SupplierNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white text-neutral-500">
      <p className="text-sm">No encontrado.</p>
    </div>
  );
}
