import { redirect } from "next/navigation";
import { ARRANGEMENTS_AREA_URL } from "@/lib/warrantyArrangements";

// Arreglos de garantía (pedido de Bryan 2026-10-15) pasó a ser una pestaña de
// "Mi área de trabajo" el 2026-10-17. Esta dirección queda para los avisos
// viejos que todavía apunten acá.
export default function ArreglosGarantiaPage() {
  redirect(ARRANGEMENTS_AREA_URL);
}
