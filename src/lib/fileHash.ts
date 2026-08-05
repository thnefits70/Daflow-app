import { createHash } from "crypto";

// Confirmado 2026-08-05: la detección de "comprobante duplicado" en Caja
// Chica es una huella digital exacta del archivo (SHA-256), no un juicio
// visual de la IA — sin costo adicional, es cómputo puro del servidor. Si
// el hash ya existe en otro PettyCashEntry, es la misma foto reutilizada.
export async function hashFileFromUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo leer el archivo para calcular su huella (${res.status}).`);
  const buf = await res.arrayBuffer();
  return createHash("sha256").update(Buffer.from(buf)).digest("hex");
}
