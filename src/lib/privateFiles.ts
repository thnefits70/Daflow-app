import { supabaseAdmin } from "@/lib/supabase";

// Documentos sensibles en carpeta PRIVADA (seguridad, pedido del usuario
// 2026-10-12). Antes vivían en el bucket público "daflow-files": cualquiera con
// el enlace los abría sin iniciar sesión. Ahora se guardan en "daflow-private"
// y el enlace guardado es https://www.daflow.app/api/files/<carpeta>/<archivo>:
// esa ruta exige sesión de DAFLOW y entrega un enlace que vence en minutos.
// Las fotos de productos siguen públicas (las usa provedix.com).
//
// Primera etapa: datos personales — roles de pago, CVs, comprobantes de
// nómina/transferencias/anticipos, adjuntos del chat de nómina, comprobantes
// de compras personales y los PDF de guías (traen nombre, teléfono y
// dirección de clientes).
export const PRIVATE_BUCKET = "daflow-private";
export const PRIVATE_MAX_BYTES = 50 * 1024 * 1024;
export const PRIVATE_FOLDERS = new Set([
  "pay-stubs",
  "cvs",
  "payroll-individual-payment-proofs",
  "payroll-transfer-proofs",
  "salary-advance-proofs",
  "payroll-message-attachments",
  "personal-purchase-proofs",
  "dropi-guides-pdf",
  "warranty-dispatch-guides",
  // Foto en vivo de la guía retenida que canceló el dropshipper (Michelle, 2026-10-15).
  "cancelled-guide-photos",
  // Arreglos de garantía (2026-10-15): comprobantes de pago y chats con clientes.
  "warranty-arrangement-files",
  // Segunda etapa (2026-10-12): documentos financieros internos. NO entran
  // los que ve CHEN sin sesión en su hoja de Google (=IMAGEN):
  // supplier-debt-transfers y supplier-shipping-photos, ni fotos de producto.
  "purchase-payments",
  "petty-cash",
  "admin-payments",
  "purchase-invoices",
  "purchase-quotes",
  "purchase-orders",
  "purchase-receipts",
  "purchase-price-corrections",
  "external-payment-proofs",
  "external-payment-invoices",
  "external-sale-payment-proofs",
  "external-sale-invoices",
  "supplier-credits",
  "finance-kpis",
  "inventory-proofs",
  "mismanagement-evidence",
  // Tareas del equipo (2026-10-13): pueden traer información interna.
  "team-task-files",
]);

// Siempre el dominio de producción: así el enlace guardado vale igual desde
// cualquier lado (y pasa las validaciones de "es una URL").
const FILES_ORIGIN = "https://www.daflow.app";
const FILES_PREFIX = "/api/files/";

export function privateFileUrl(path: string): string {
  return `${FILES_ORIGIN}${FILES_PREFIX}${path.split("/").map(encodeURIComponent).join("/")}`;
}

// Ruta dentro del bucket privado, o null si no es un enlace de /api/files/.
export function privatePathOf(url: string): string | null {
  const i = url.indexOf(FILES_PREFIX);
  if (i < 0) return null;
  const path = url.slice(i + FILES_PREFIX.length).split("?")[0];
  try {
    return path.split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}

export function isPrivateFolder(path: string): boolean {
  return PRIVATE_FOLDERS.has(path.split("/")[0]);
}

let bucketReady = false;
export async function ensurePrivateBucket() {
  if (bucketReady) return;
  const supabase = supabaseAdmin();
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some((b) => b.name === PRIVATE_BUCKET)) {
    await supabase.storage.createBucket(PRIVATE_BUCKET, { public: false, fileSizeLimit: PRIVATE_MAX_BYTES });
  }
  bucketReady = true;
}

// Para el servidor (IA que revisa comprobantes, lectura de guías, huellas de
// archivos): un enlace privado se descarga directo del bucket; cualquier otro
// se pide normal. Devuelve un Response igual que fetch().
export async function fetchStoredFile(url: string): Promise<Response> {
  const path = privatePathOf(url);
  if (!path) return fetch(url);
  const { data, error } = await supabaseAdmin().storage.from(PRIVATE_BUCKET).download(path);
  if (error || !data) return new Response(null, { status: 404 });
  return new Response(data, { status: 200, headers: { "content-type": data.type || "application/octet-stream" } });
}
