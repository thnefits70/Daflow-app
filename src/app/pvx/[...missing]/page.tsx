import { notFound } from "next/navigation";

// Cualquier dirección de provedix.com que no existe llega acá (el proxy la
// manda a /pvx/no-encontrado) y muestra la página "no encontrado" de
// Provedix (pvx/not-found.tsx), con estado 404. Pedido del usuario 2026-10-16.
export default function Missing() {
  notFound();
}
