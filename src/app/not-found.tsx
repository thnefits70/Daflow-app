// "No encontrado" general (DAFLOW). 2026-10-17: ya no mira el dominio, porque
// leer los encabezados aquí volvía dinámicas todas las páginas de la app. Los
// otros dominios se cubren antes de llegar aquí:
// - dunxingchen.cc: src/proxy.ts solo deja pasar las rutas exactas del
//   proveedor (lo demás, 404 vacío) y su sección tiene su propio not-found.
// - provedix.com: src/proxy.ts manda todo lo desconocido a /pvx/no-encontrado.
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white text-neutral-500">
      <p className="text-sm">404 — Esta página no existe.</p>
    </div>
  );
}
