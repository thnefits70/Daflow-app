import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { TopLine } from "@/components/ui/TopLine";
import { SupplierExchangeMyResolutions } from "@/components/merchandise-outflow/SupplierExchangeMyResolutions";

// Confirmado 2026-08-26, pedido explícito del usuario: página propia (no una
// pestaña de Registro de Egresos) porque quien gestiona acá es quien
// solicitó originalmente la compra de cada producto — puede ser cualquier
// empleado activo, no necesariamente alguien con acceso a ese módulo. Mismo
// criterio de acceso que /area/compras-personales: sin permiso de
// departamento, la API filtra por dueño real (ver
// /api/merchandise-outflow/supplier-exchange/mine).
export default async function CambioProveedorGestionesPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div>
      <TopLine eyebrow="Registro de Egresos" title="Cambio con proveedor" />
      <p className="text-[13px] text-steel mb-5 max-w-lg">
        Acá aparecen los productos de tus compras que Inventario está devolviendo a un proveedor para cambio. Contacta al proveedor y registra si aceptó cambiarlo o dar crédito.
      </p>
      <SupplierExchangeMyResolutions />
    </div>
  );
}
