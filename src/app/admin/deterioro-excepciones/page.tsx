import { PurchaseDeteriorExceptionsPanel } from "@/components/merchandise-outflow/PurchaseDeteriorExceptionsPanel";
import { PurchaseNoProofApprovalsPanel } from "@/components/merchandise-outflow/PurchaseNoProofApprovalsPanel";

// Confirmado 2026-09-17, pedido explícito del usuario: cuando quien gestiona
// compras (Jariel) no encuentra ninguna compra real que respalde un reclamo
// de deterioro, nunca se cierra el caso solo — llega acá para que admin
// decida (corregir el dato, autorizar sin respaldo, o rechazar). Página
// standalone, mismo patrón que /admin/reingreso-mercaderia — se llega vía el
// aviso de "Pendientes de esta semana" o el push, no por un menú fijo.
// Confirmado 2026-09-28: también los reclamos que Jariel pide cerrar SIN
// captura con CHEN (arregla todo por llamada o en persona).
export default function AdminDeterioroExcepcionesPage() {
  return (
    <div>
      <h1 className="font-display text-[22px] font-bold mb-1">Reclamos sin captura (Chen)</h1>
      <p className="text-[13px] text-steel mb-5">
        Chen arregla por llamada o en persona, así que no hay captura. Revisa la explicación y si el producto ya tuvo otros reclamos antes de aprobar.
      </p>
      <div className="mb-8">
        <PurchaseNoProofApprovalsPanel />
      </div>

      <h1 className="font-display text-[22px] font-bold mb-1">Reclamos de deterioro sin respaldo</h1>
      <p className="text-[13px] text-steel mb-5">
        Jariel no encontró ninguna compra real que sustente estos reclamos con el proveedor que eligió. Decide cómo seguir.
      </p>
      <PurchaseDeteriorExceptionsPanel />
    </div>
  );
}
