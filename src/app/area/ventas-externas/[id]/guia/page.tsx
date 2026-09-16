import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canAssignExternalSalePack } from "@/lib/guards";
import { PrintButton } from "@/app/rol-del-mes/[id]/PrintButton";

// Confirmado 2026-09-16, pedido explícito del usuario: esta hoja la ve el
// motorizado/cliente al recibir el pedido, así que no debe llevar nada
// interno de Daflow (dominio, trazabilidad, id de producto) — solo lo que
// el motorizado necesita para entregar y, si aplica, cobrar.
export default async function ExternalSaleGuidePage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await canAssignExternalSalePack())) redirect("/login");

  const { id } = await params;
  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: {
      code: true,
      pickupPersonName: true,
      courierNote: true,
      isContraEntrega: true,
      totalAmount: true,
      clientName: true,
      client: { select: { name: true, address: true, phone: true } },
      advisor: { select: { phone: true } },
      items: { select: { declaredProductName: true, quantity: true, catalogItem: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!sale) notFound();

  const clientName = sale.client?.name ?? sale.clientName;

  return (
    <div className="min-h-screen bg-white text-black py-12 px-6 print:p-0">
      <PrintButton />
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-6">
          <div className="text-[11px] tracking-[0.2em] font-bold text-gray-500 uppercase">Guía de salida</div>
          <div className="text-[20px] font-bold mt-1">{sale.code}</div>
        </div>

        <div className={`border-2 rounded-md py-3 px-4 mb-6 text-center ${sale.isContraEntrega ? "border-black" : "border-gray-400"}`}>
          {sale.isContraEntrega ? (
            <>
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-600">Cobrar al cliente</div>
              <div className="text-[24px] font-bold mt-1">${sale.totalAmount.toFixed(2)}</div>
            </>
          ) : (
            <div className="text-[15px] font-bold uppercase tracking-wide">Sin cobro — solo entregar</div>
          )}
        </div>

        <div className="border-t border-b border-gray-300 py-4 mb-6">
          {sale.items.map((it, i) => (
            <div key={i} className="flex justify-between text-[13px] mt-1 first:mt-0">
              <span className="text-gray-500">{it.catalogItem?.name ?? it.declaredProductName}</span>
              <span className="font-semibold">{it.quantity} un.</span>
            </div>
          ))}
        </div>

        <table className="w-full text-[13px]">
          <tbody>
            <tr className="border-b border-gray-200">
              <td className="py-2 text-gray-500">Cliente</td>
              <td className="py-2 text-right font-semibold">{clientName ?? "—"}</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="py-2 text-gray-500 align-top">Dirección</td>
              <td className="py-2 text-right font-semibold">{sale.client?.address ?? "—"}</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="py-2 text-gray-500">Celular cliente</td>
              <td className="py-2 text-right font-semibold">{sale.client?.phone ?? "—"}</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="py-2 text-gray-500">Entregar a (motorizado)</td>
              <td className="py-2 text-right font-semibold">{sale.pickupPersonName}</td>
            </tr>
            {sale.courierNote && (
              <tr className="border-b border-gray-200">
                <td className="py-2 text-gray-500">Transportadora</td>
                <td className="py-2 text-right font-semibold">{sale.courierNote}</td>
              </tr>
            )}
            <tr className="border-b border-gray-200">
              <td className="py-2 text-gray-500">Contacto asesor</td>
              <td className="py-2 text-right font-semibold">{sale.advisor.phone ?? "—"}</td>
            </tr>
            <tr>
              <td className="py-2 text-gray-500">Valor total del pedido</td>
              <td className="py-2 text-right font-semibold">${sale.totalAmount.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
