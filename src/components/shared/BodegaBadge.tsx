// Pedido de la asesora B2B 2026-10-16: recuadro azul para Importadora Damián
// y naranja (color de provedix.com) para Provedix, para distinguir de un
// vistazo de qué bodega es cada producto (Mercadería recibida, Publicar en
// Dropi). Otras bodegas o sin bodega: no muestra nada.
export function BodegaBadge({ bodega, className = "" }: { bodega: string | null | undefined; className?: string }) {
  if (bodega !== "MKT_DAMIAN" && bodega !== "MKT_PROVEDIX") return null;
  const color = bodega === "MKT_DAMIAN" ? "#2563EB" : "#F95B02";
  return (
    <span
      className={`inline-block rounded border px-2 py-0.5 text-[10.5px] font-bold leading-none ${className}`}
      style={{ color, borderColor: `${color}80`, backgroundColor: `${color}1F` }}
    >
      {bodega === "MKT_DAMIAN" ? "Importadora Damián" : "Provedix"}
    </span>
  );
}
