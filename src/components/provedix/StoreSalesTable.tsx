// Tiendas (dropshippers) que más venden nuestros productos, leídas de las
// guías — la usan la sección Provedix (admin) y Servicio Postventa (Nairoby,
// pedido del usuario 2026-10-10: "Nairoby y yo podemos ver"). Nunca sale en
// provedix.com. Sin dependencias de servidor.
export type StoreSalesRow = { name: string; phone: string | null; count: number };

// WhatsApp, no llamada (pedido del usuario 2026-10-10: la mayoría de los
// dropshippers no contesta llamadas). wa.me pide el número con el código de
// país y sin el 0: 0991234567 → 593991234567; +57… ya lo trae.
function whatsappHref(phone: string) {
  const d = phone.replace(/\D/g, "");
  return `https://wa.me/${d.startsWith("0") ? `593${d.slice(1)}` : d}`;
}

export function StoreSalesTable({ stores }: { stores: StoreSalesRow[] }) {
  if (stores.length === 0) return <div className="text-[12px] text-steel">Todavía no hay guías leídas.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-wide text-steel">
            <th className="pb-2 pr-3 font-semibold">Tienda</th>
            <th className="pb-2 pr-3 font-semibold">Celular</th>
            <th className="pb-2 font-semibold text-right">Pedidos</th>
          </tr>
        </thead>
        <tbody>
          {stores.map((s) => (
            <tr key={s.name} className="border-t border-rule">
              <td className="py-2 pr-3">{s.name}</td>
              <td className="py-2 pr-3 tabular-nums">
                {s.phone ? (
                  <a href={whatsappHref(s.phone)} target="_blank" rel="noopener noreferrer" className="text-teal hover:underline" title="Escribir por WhatsApp">
                    💬 {s.phone}
                  </a>
                ) : (
                  <span className="text-steel">—</span>
                )}
              </td>
              <td className="py-2 text-right tabular-nums font-semibold">{s.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
