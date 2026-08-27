import { redirect } from "next/navigation";

// Confirmado 2026-08-27, pedido explícito del usuario: ya no es una página
// aparte — "Cambio con proveedor" ahora vive dentro de "Mi área de trabajo"
// (pestaña "Registro de Egresos" → "Cambio con proveedor"), visible para
// cualquier empleado con algo pendiente aunque no tenga ningún otro permiso
// de ese módulo (ver supplierExchangeMineCount en DeptWorkspaceTabs /
// MerchandiseOutflowPanel). Esta ruta se deja como redirect para no romper
// links viejos (ej. mandados por WhatsApp antes de este cambio).
export default function CambioProveedorGestionesPage() {
  redirect("/area/workspace?tab=egresos&otab=proveedor");
}
