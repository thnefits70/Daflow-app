import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { canAssignExternalSalePack } from "@/lib/guards";
import { PrintButton } from "@/app/rol-del-mes/[id]/PrintButton";

// Confirmado 2026-09-16, pedido explícito del usuario: esta hoja la ve el
// motorizado/cliente al recibir el pedido, así que no debe llevar nada
// interno de Daflow (dominio, trazabilidad, id de producto, ni la palabra
// "Daflow" en ningún lado) — solo lo que el motorizado necesita para
// entregar y, si aplica, cobrar. Título propio (en vez del "DAFLOW —
// Process Standardization Platform" del layout raíz) para que el
// encabezado de impresión del navegador tampoco muestre la marca.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const sale = await prisma.externalSale.findUnique({ where: { id }, select: { code: true } });
  return { title: sale ? `Guía ${sale.code}` : "Guía de salida" };
}

// Confirmado 2026-09-16: esta página vive FUERA de /area a propósito
// (mismo patrón que rol-del-mes/[id]) — /area/layout.tsx envuelve todo con
// AreaGateShell (sidebar + logo de la empresa), que en la impresión a
// 110x110mm no tiene espacio para colapsar bien y el logo terminaba
// tapando el texto de la guía. Al vivir fuera de /area, esta página nunca
// carga ese shell — el permiso se revisa acá mismo, no por el layout.
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
    <div className="min-h-screen bg-white text-black py-12 px-6 print:min-h-0 print:p-[3mm] print:w-[110mm]">
      {/* Confirmado 2026-09-16, pedido explícito del usuario: la etiqueta de
          la impresora (Zebra) mide 110x110mm — sin fijar @page, el navegador
          adivina un tamaño de hoja normal y el contenido se corta en 2
          páginas. Los tamaños print:* de abajo están en mm, pensados para
          que TODO el contenido quepa dentro de ese cuadro de una sola vez. */}
      <style>{"@page { size: 110mm 110mm; margin: 0; }"}</style>
      <PrintButton />
      <div className="max-w-xl mx-auto print:max-w-none print:mx-0">
        <div className="text-center mb-6 print:mb-[2mm]">
          <div className="text-[11px] tracking-[0.2em] font-bold text-gray-500 uppercase print:text-[1.8mm]">Guía de salida</div>
          <div className="text-[20px] font-bold mt-1 print:text-[4.5mm] print:mt-0">{sale.code}</div>
        </div>

        <div className={`border-2 rounded-md py-3 px-4 mb-6 text-center print:py-[1.5mm] print:px-[2mm] print:mb-[2mm] print:rounded-none ${sale.isContraEntrega ? "border-black" : "border-gray-400"}`}>
          {sale.isContraEntrega ? (
            <>
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-600 print:text-[1.8mm]">Cobrar al cliente</div>
              <div className="text-[24px] font-bold mt-1 print:text-[5.5mm] print:mt-0">${sale.totalAmount.toFixed(2)}</div>
            </>
          ) : (
            <div className="text-[15px] font-bold uppercase tracking-wide print:text-[3mm]">Sin cobro — solo entregar</div>
          )}
        </div>

        <div className="border-t border-b border-gray-300 py-4 mb-6 print:py-[1.5mm] print:mb-[2mm]">
          {sale.items.map((it, i) => (
            <div key={i} className="flex justify-between text-[13px] mt-1 first:mt-0 print:text-[2.3mm] print:mt-[0.5mm]">
              <span className="text-gray-500">{it.catalogItem?.name ?? it.declaredProductName}</span>
              <span className="font-semibold">{it.quantity} un.</span>
            </div>
          ))}
        </div>

        <table className="w-full text-[13px] print:text-[2.3mm]">
          <tbody>
            <tr className="border-b border-gray-200">
              <td className="py-2 text-gray-500 print:py-[0.8mm]">Cliente</td>
              <td className="py-2 text-right font-semibold print:py-[0.8mm]">{clientName ?? "—"}</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="py-2 text-gray-500 align-top print:py-[0.8mm]">Dirección</td>
              <td className="py-2 text-right font-semibold print:py-[0.8mm]">{sale.client?.address ?? "—"}</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="py-2 text-gray-500 print:py-[0.8mm]">Celular cliente</td>
              <td className="py-2 text-right font-semibold print:py-[0.8mm]">{sale.client?.phone ?? "—"}</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="py-2 text-gray-500 print:py-[0.8mm]">Entregar a (motorizado)</td>
              <td className="py-2 text-right font-semibold print:py-[0.8mm]">{sale.pickupPersonName}</td>
            </tr>
            {sale.courierNote && (
              <tr className="border-b border-gray-200">
                <td className="py-2 text-gray-500 print:py-[0.8mm]">Transportadora</td>
                <td className="py-2 text-right font-semibold print:py-[0.8mm]">{sale.courierNote}</td>
              </tr>
            )}
            <tr className="border-b border-gray-200">
              <td className="py-2 text-gray-500 print:py-[0.8mm]">Contacto asesor</td>
              <td className="py-2 text-right font-semibold print:py-[0.8mm]">{sale.advisor.phone ?? "—"}</td>
            </tr>
            <tr>
              <td className="py-2 text-gray-500 print:py-[0.8mm]">Valor total del pedido</td>
              <td className="py-2 text-right font-semibold print:py-[0.8mm]">${sale.totalAmount.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
