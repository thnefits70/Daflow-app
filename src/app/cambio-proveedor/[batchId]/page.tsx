import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow } from "@/lib/guards";
import { resolveOutflowItemGestorId } from "@/lib/merchandiseOutflow";
import { PrintButton } from "@/app/rol-del-mes/[id]/PrintButton";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

const DATE_FMT = new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

// Confirmado 2026-08-26: pedido explícito del usuario — al dejar lista una
// solicitud de "Cambio con proveedor" (Registro de Egresos), esta guía se
// imprime y se pega junto con el paquete físico donde van agrupados todos
// los productos, para que quede organizado tanto en papel como en bodega.
// Muestra el costo pagado por producto (de la última compra vinculada a ese
// proveedor), quién solicitó originalmente esa compra, quién agrupó esta
// solicitud, y quién es el líder responsable (hoy siempre la misma persona,
// Daniel, porque canActOnMerchandiseOutflow es exclusivo del líder de
// Inventario — se listan como campos separados igual, para la trazabilidad
// que pidió el usuario).
export default async function CambioProveedorGuiaPage({ params }: { params: Promise<{ batchId: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");

  const { batchId } = await params;
  const batch = await prisma.merchandiseOutflowBatch.findUnique({
    where: { id: batchId },
    include: {
      supplier: { select: { name: true } },
      createdBy: { select: { name: true } },
      items: {
        include: {
          catalogItem: { select: { name: true } },
          linkedPurchaseRequest: { select: { requestNumber: true, requestedAt: true, requestedById: true, requestedBy: { select: { name: true } } } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!batch || batch.reason !== "CAMBIO_PROVEEDOR" || !batch.submittedAt) notFound();

  // Fix confirmado 2026-08-27 (reportado por el usuario: "Ver guía" no
  // dejaba entrar) — quien gestiona cada producto (ver
  // resolveOutflowItemGestorId, típicamente quien pidió esa compra
  // originalmente, o Bryan de respaldo) también necesita esta guía para
  // negociar con el proveedor, no solo Daniel/admin.
  const gestorIds = await Promise.all(batch.items.map((i) => resolveOutflowItemGestorId(i)));
  const isGestor = gestorIds.includes(session.user.id);
  const canView = session.user.role === "admin" || (await canActOnMerchandiseOutflow()) || isGestor;
  if (!canView) redirect("/area/workspace");

  const itemsWithCost = batch.items.filter((i) => i.expectedCreditAmount !== null);
  const totalCredit = itemsWithCost.reduce((sum, i) => sum + (i.expectedCreditAmount ?? 0), 0);

  return (
    <div className="min-h-screen bg-white text-black py-12 px-6 print:p-0">
      <PrintButton />
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-6">
          <div className="text-[11px] tracking-[0.2em] font-bold text-gray-500 uppercase">Provedix</div>
          <div className="text-[20px] font-bold mt-1">Guía de cambio con proveedor</div>
          <div className="text-[24px] font-mono font-black tracking-wide mt-2 border-2 border-black inline-block px-4 py-1">{batch.code}</div>
        </div>

        <div className="border-t border-b border-gray-300 py-4 mb-6 grid grid-cols-2 gap-y-1.5 text-[12.5px]">
          <span className="text-gray-500">Proveedor</span>
          <span className="font-semibold text-right">{batch.supplier?.name ?? "—"}</span>
          <span className="text-gray-500">Fecha de envío</span>
          <span className="font-semibold text-right">{DATE_FMT.format(batch.submittedAt)}</span>
          <span className="text-gray-500">Agrupado y enviado por</span>
          <span className="font-semibold text-right">{batch.createdBy?.name ?? "—"}</span>
          <span className="text-gray-500">Líder responsable</span>
          <span className="font-semibold text-right">{batch.createdBy?.name ?? "—"} — Líder de Inventario</span>
        </div>

        <table className="w-full text-[12px] mb-4">
          <thead>
            <tr className="border-b-2 border-black text-left text-[10.5px] uppercase tracking-wide text-gray-500">
              <th className="py-1.5 pr-2">Producto</th>
              <th className="py-1.5 px-2 text-right">Cant.</th>
              <th className="py-1.5 px-2 text-right">Costo un.</th>
              <th className="py-1.5 px-2 text-right">Total</th>
              <th className="py-1.5 pl-2">Solicitado originalmente por</th>
            </tr>
          </thead>
          <tbody>
            {batch.items.map((item) => (
              <tr key={item.id} className="border-b border-gray-200">
                <td className="py-2 pr-2 font-medium">{item.catalogItem?.name ?? item.declaredName}</td>
                <td className="py-2 px-2 text-right">{item.quantity}</td>
                <td className="py-2 px-2 text-right">{item.unitCostAtExchange !== null ? money(item.unitCostAtExchange) : "—"}</td>
                <td className="py-2 px-2 text-right font-semibold">{item.expectedCreditAmount !== null ? money(item.expectedCreditAmount) : "—"}</td>
                <td className="py-2 pl-2 text-gray-600">
                  {item.linkedPurchaseRequest ? (
                    <>
                      {item.linkedPurchaseRequest.requestedBy?.name ?? "—"}
                      {item.linkedPurchaseRequest.requestNumber ? ` (SC-${String(item.linkedPurchaseRequest.requestNumber).padStart(3, "0")})` : ""}
                    </>
                  ) : (
                    "sin compra vinculada"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="py-3 font-bold">Total crédito estimado</td>
              <td className="py-3 text-right font-bold text-[15px]">{money(totalCredit)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        {itemsWithCost.length < batch.items.length && (
          <p className="text-[10.5px] text-gray-500 mb-6">
            El total solo suma los productos con historial de compra a este proveedor — los marcados &quot;—&quot; no tienen costo de referencia registrado.
          </p>
        )}

        <div className="mt-10 pt-6 border-t border-gray-300 flex justify-between gap-8 text-[11.5px]">
          <div className="flex-1 text-center">
            <div className="border-t border-gray-400 pt-1.5 mt-8">Firma — Líder de Inventario</div>
          </div>
          <div className="flex-1 text-center">
            <div className="border-t border-gray-400 pt-1.5 mt-8">Firma — Recibe el proveedor</div>
          </div>
        </div>

        <div className="mt-8 text-center text-[10.5px] text-gray-400">
          Recorta y pega esta guía junto con el paquete físico. Emitido el {DATE_FMT.format(new Date())}.
        </div>
        <div className="text-center text-[16px] font-mono font-black tracking-wide mt-2">{batch.code}</div>
      </div>
    </div>
  );
}
