import { headers } from "next/headers";
import type { Metadata } from "next";

// Confirmado 2026-09-17, bug real reportado por el usuario: visitar una URL
// de dunxingchen.cc que NO calza con ninguna página real (ej. /proveedor-ledger
// sin código al final) sí devuelve 404 (el proxy ya lo bloquea, contenido
// genérico sin nada de DAFLOW) — pero el TÍTULO de la pestaña seguía diciendo
// "DAFLOW — Process Standardization Platform", porque una ruta que no calza
// con NINGUNA página usa el 404 por defecto de Next, que hereda el título
// del layout raíz (app/layout.tsx) — ese layout no tiene forma de saber que
// está sirviendo el dominio de un proveedor. Antes de este archivo no existía
// un not-found.tsx propio; Next usaba el suyo interno, siempre envuelto en el
// layout raíz. Mismo chequeo de dominio que src/proxy.ts.
const SUPPLIER_LEDGER_DOMAIN = process.env.NEXT_PUBLIC_SUPPLIER_LEDGER_DOMAIN;

async function isSupplierLedgerDomain() {
  const host = (await headers()).get("host");
  return !!SUPPLIER_LEDGER_DOMAIN && host?.split(":")[0] === SUPPLIER_LEDGER_DOMAIN;
}

export async function generateMetadata(): Promise<Metadata> {
  if (await isSupplierLedgerDomain()) {
    return {
      title: "No encontrado",
      description: "",
      icons: { icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" },
    };
  }
  // Fuera de ese dominio, no se toca nada: se deja vacío para que el título
  // "DAFLOW — Process Standardization Platform" del layout raíz siga
  // aplicando igual que antes de este archivo existir.
  return {};
}

export default async function NotFound() {
  const onSupplierDomain = await isSupplierLedgerDomain();
  return (
    <div className="flex min-h-screen items-center justify-center bg-white text-neutral-500">
      <p className="text-sm">{onSupplierDomain ? "No encontrado." : "404 — Esta página no existe."}</p>
    </div>
  );
}
