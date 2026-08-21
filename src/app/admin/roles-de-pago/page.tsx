import { redirect } from "next/navigation";

// Confirmado 2026-08-21: pedido explícito del usuario — "Roles de pago" ya
// no es una pantalla aparte, ahora vive como pestaña dentro de Nómina.
export default function AdminRolesDePagoRedirect() {
  redirect("/admin/nomina?tab=rolesdepago");
}
