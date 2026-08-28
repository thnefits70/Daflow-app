import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PrintButton } from "./PrintButton";
import { formatDateTime } from "@/lib/formatDateTime";

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function monthLabel(month: string) {
  const [y, m] = month.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Confirmado 2026-08-24: pedido explícito del usuario — reemplaza la subida
// manual de comprobantes por un PDF que cada colaborador genera solo,
// deliberadamente sin ningún rango de fechas (nunca "1-15" ni "16-fin") —
// solo el mes, para que no se vea que se le paga la mitad de un mes
// trabajado completo. Exclusivo del "Rol del mes" (fin de mes) — la primera
// quincena nunca tiene nada que mostrarle al colaborador, por diseño.
export default async function RolDelMesPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role === "admin") redirect("/login");

  const { id } = await params;
  const role = await prisma.monthlyLegalRole.findUnique({
    where: { id },
    include: { employee: { select: { id: true, name: true, position: true } } },
  });
  if (!role || role.employeeId !== session.user.id) notFound();

  return (
    <div className="min-h-screen bg-white text-black py-12 px-6 print:p-0">
      <PrintButton />
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-8">
          <div className="text-[11px] tracking-[0.2em] font-bold text-gray-500 uppercase">Provedix</div>
          <div className="text-[20px] font-bold mt-1">Rol de pago</div>
          <div className="text-[14px] text-gray-600">{monthLabel(role.month)}</div>
        </div>

        <div className="border-t border-b border-gray-300 py-4 mb-6">
          <div className="flex justify-between text-[13px]"><span className="text-gray-500">Colaborador</span><span className="font-semibold">{role.employee.name}</span></div>
          {role.employee.position && (
            <div className="flex justify-between text-[13px] mt-1"><span className="text-gray-500">Cargo</span><span className="font-semibold">{role.employee.position}</span></div>
          )}
        </div>

        <table className="w-full text-[13px]">
          <tbody>
            <tr className="border-b border-gray-200">
              <td className="py-2 text-gray-600">Sueldo</td>
              <td className="py-2 text-right font-semibold">{money(role.declaredSalary)}</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="py-2 text-gray-600">Descuento IESS (9.45%)</td>
              <td className="py-2 text-right font-semibold text-red-600">−{money(role.iessDeduction)}</td>
            </tr>
            <tr>
              <td className="py-3 font-bold">Total a recibir</td>
              <td className="py-3 text-right font-bold text-[16px]">{money(role.netTotal)}</td>
            </tr>
          </tbody>
        </table>

        {role.payoutProofUrl && (
          <div className="mt-8 pt-6 border-t border-gray-300">
            <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Comprobante de pago</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={role.payoutProofUrl} alt="Comprobante de pago" className="max-w-full rounded border border-gray-300" />
          </div>
        )}

        <div className="mt-10 text-[10.5px] text-gray-400 text-center">
          Emitido el {formatDateTime(new Date())}
        </div>
      </div>
    </div>
  );
}
