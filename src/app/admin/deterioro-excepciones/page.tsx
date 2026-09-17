import { PurchaseDeteriorExceptionsPanel } from "@/components/merchandise-outflow/PurchaseDeteriorExceptionsPanel";

// Confirmado 2026-09-17, pedido explícito del usuario: cuando quien gestiona
// compras (Jariel) no encuentra ninguna compra real que respalde un reclamo
// de deterioro, nunca se cierra el caso solo — llega acá para que admin
// decida (corregir el dato, autorizar sin respaldo, o rechazar). Página
// standalone, mismo patrón que /admin/reingreso-mercaderia — se llega vía el
// aviso de "Pendientes de esta semana" o el push, no por un menú fijo.
export default function AdminDeterioroExcepcionesPage() {
  return (
    <div>
      <h1 className="font-display text-[22px] font-bold mb-1">Reclamos de deterioro sin respaldo</h1>
      <p className="text-[13px] text-steel mb-5">
        Jariel no encontró ninguna compra real que sustente estos reclamos con el proveedor que eligió. Decide cómo seguir.
      </p>
      <PurchaseDeteriorExceptionsPanel />
    </div>
  );
}
