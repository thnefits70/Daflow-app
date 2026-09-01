import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canAssignExternalSalePack } from "@/lib/guards";
import { formatDateTime } from "@/lib/formatDateTime";
import { PrintButton } from "@/app/rol-del-mes/[id]/PrintButton";

// Confirmado 2026-08-29, pedido explícito del usuario: la guía de salida
// solo la imprime Yair (líder de Fulfilment) — Daniel la genera pero nunca
// la imprime, él ya despachó lo suyo al agrupar. Sin precios y sin los
// nombres de quién hizo cada gestión, solo fecha y hora de cada paso.
export default async function ExternalSaleGuidePage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await canAssignExternalSalePack())) redirect("/login");

  const { id } = await params;
  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: {
      code: true,
      pickupPersonName: true,
      courierNote: true,
      createdAt: true,
      reviewedAt: true,
      prepReadyAt: true,
      packAssignedAt: true,
      items: { select: { declaredProductName: true, quantity: true, catalogItem: { select: { name: true, justCode: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!sale) notFound();

  const steps = [
    { label: "Venta declarada", at: sale.createdAt },
    { label: "Aprobada", at: sale.reviewedAt },
    { label: "Agrupada por Inventario", at: sale.prepReadyAt },
    { label: "Asignada para embalar", at: sale.packAssignedAt },
  ].filter((s) => s.at);

  return (
    <div className="min-h-screen bg-white text-black py-12 px-6 print:p-0">
      <PrintButton />
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-8">
          <div className="text-[11px] tracking-[0.2em] font-bold text-gray-500 uppercase">Guía de salida</div>
          <div className="text-[20px] font-bold mt-1">{sale.code}</div>
        </div>

        <div className="border-t border-b border-gray-300 py-4 mb-6">
          {sale.items.map((it, i) => (
            <div key={i} className="flex justify-between text-[13px] mt-1 first:mt-0">
              <span className="text-gray-500">
                {it.catalogItem?.justCode ? `${it.catalogItem.justCode} — ` : ""}
                {it.catalogItem?.name ?? it.declaredProductName}
              </span>
              <span className="font-semibold">{it.quantity} un.</span>
            </div>
          ))}
          <div className="flex justify-between text-[13px] mt-1">
            <span className="text-gray-500">Entregar a</span>
            <span className="font-semibold">{sale.pickupPersonName}</span>
          </div>
          {sale.courierNote && (
            <div className="flex justify-between text-[13px] mt-1">
              <span className="text-gray-500">Transportadora</span>
              <span className="font-semibold">{sale.courierNote}</span>
            </div>
          )}
        </div>

        <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-2">Trazabilidad</div>
        <table className="w-full text-[13px]">
          <tbody>
            {steps.map((s) => (
              <tr key={s.label} className="border-b border-gray-200">
                <td className="py-2 text-gray-600">{s.label}</td>
                <td className="py-2 text-right font-semibold">{s.at ? formatDateTime(s.at.toISOString()) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
