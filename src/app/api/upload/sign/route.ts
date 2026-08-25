import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";
import {
  canManagePayroll,
  canManageNomina,
  canSubmitPurchaseRequests,
  canConfirmPurchaseReceiving,
  canRegisterPurchaseInvoices,
  canManageInventoryControl,
  canManagePettyCashPrincipal,
  canManagePettyCashSecundaria,
  canManageAdminPayments,
  canConfirmPersonalPurchaseInventory,
  canCaptureMerchandiseReentry,
  canCaptureMerchandiseOutflow,
  canManageJustCatalog,
  canEditPayrollRoles,
} from "@/lib/guards";

// Confirmado 2026-08-03: bug real — ninguna de estas carpetas de Control de
// Compras (cotización, orden de compra, fotos de catálogo, comprobante de
// pago, factura, foto de recepción) tenía autorización para empleados, así
// que CUALQUIERA que no fuera admin recibía "No autorizado" al subir algo
// ahí, sin importar sus permisos de Control de Compras. Cualquiera de las
// tres capacidades del módulo autoriza las seis carpetas — la carpeta en sí
// no es el límite de seguridad, la ruta que después usa esa URL sí lo es.
const PURCHASE_MODULE_FOLDERS = [
  "purchase-quotes",
  "purchase-orders",
  "purchase-catalog",
  "purchase-payments",
  "purchase-invoices",
  "purchase-request-receipts",
  "supplier-credits",
];

const BUCKET = "daflow-files";
// Confirmado 2026-08-25: 15 MB dejaba fuera videos de recepción de más de
// 2-4 segundos (el celular graba sin comprimir, ver PurchaseReceivingPanel).
// La subida va directo navegador -> Supabase, así que no hay límite técnico
// de Vercel de por medio — 50 MB es solo cuánto storage se permite gastar.
const MAX_BYTES = 50 * 1024 * 1024;

async function ensureBucket() {
  const supabase = supabaseAdmin();
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((b) => b.name === BUCKET)) {
    // El bucket ya existía con el fileSizeLimit viejo (15 MB) — sin este
    // update, Supabase seguiría rechazando la subida real aunque nuestro
    // chequeo de arriba ya deje pasar hasta MAX_BYTES.
    await supabase.storage.updateBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES });
    return;
  }
  await supabase.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES });
}

const signSchema = z.object({
  fileName: z.string().trim().min(1),
  folder: z.string().trim().min(1).optional().default("misc"),
  size: z.number().int().nonnegative(),
});

// Confirmado 2026-07-25: Vercel rechaza cualquier cuerpo de solicitud de más
// de ~4.5 MB antes de que este código siquiera se ejecute — así que la
// subida original (navegador -> nuestra función -> Supabase) tenía un techo
// mucho más bajo que los 15 MB que el código permitía. Esta ruta en cambio
// solo genera una URL firmada; el navegador sube el archivo directo a
// Supabase Storage (ver src/lib/uploadFile.ts), sin pasar por esta función,
// así que el límite real vuelve a ser MAX_BYTES.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = signSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const { fileName, folder, size } = parsed.data;

  const session = await auth();
  let allowed = session?.user.role === "admin";
  if (!allowed && session?.user.role === "employee" && folder === "finance-kpis") {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isLeader: true, leadsDeptId: true },
    });
    allowed = !!user?.isLeader && user.leadsDeptId === session.user.deptId;
  }
  if (!allowed && session?.user.role === "employee" && folder === "documents") {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { canManageLaws: true },
    });
    allowed = !!user?.canManageLaws;
  }
  if (!allowed && session?.user.role === "employee" && folder === "pay-stubs") {
    allowed = await canManagePayroll();
  }
  // Nómina profile photo/CV uploads — same access as editing the rest of
  // the profile (canManageNomina), not just admin.
  if (!allowed && session?.user.role === "employee" && (folder === "photos" || folder === "cvs")) {
    allowed = await canManageNomina();
  }
  if (!allowed && session?.user.role === "employee" && PURCHASE_MODULE_FOLDERS.includes(folder)) {
    allowed = (await canSubmitPurchaseRequests()) || (await canConfirmPurchaseReceiving()) || (await canRegisterPurchaseInvoices());
  }
  // Confirmado 2026-08-05: mismo bug de nuevo — Control de Inventario y Caja
  // Chica se lanzaron con carpetas propias que nunca se agregaron aquí, así
  // que Daniel (y cualquiera sin ser admin) recibía "No autorizado" al subir
  // una captura, sin importar que sí tuviera el permiso del módulo.
  if (!allowed && session?.user.role === "employee" && (folder === "inventory-proofs" || folder === "inventory-stock-snapshot")) {
    allowed = await canManageInventoryControl();
  }
  if (!allowed && session?.user.role === "employee" && (folder === "petty-cash" || folder === "petty-cash-proofs")) {
    allowed = (await canManagePettyCashPrincipal()) || (await canManagePettyCashSecundaria());
  }
  if (!allowed && session?.user.role === "employee" && folder === "admin-payments") {
    allowed = await canManageAdminPayments();
  }
  // Confirmado 2026-08-18: la foto en vivo de una compra personal la sube
  // cualquier colaborador (no hace falta ningún permiso especial, todos
  // pueden comprar) — el catálogo de productos en cambio solo lo mantiene
  // quien puede confirmar compras personales en Inventario (Daniel/admin).
  if (!allowed && session?.user.role === "employee" && (folder === "personal-purchase-photos" || folder === "personal-purchase-proofs")) {
    allowed = true;
  }
  if (!allowed && session?.user.role === "employee" && folder === "retail-product-photos") {
    allowed = await canConfirmPersonalPurchaseInventory();
  }
  if (!allowed && session?.user.role === "employee" && folder === "merchandise-reentry-photos") {
    allowed = await canCaptureMerchandiseReentry();
  }
  if (!allowed && session?.user.role === "employee" && folder === "merchandise-outflow-photos") {
    allowed = await canCaptureMerchandiseOutflow();
  }
  if (!allowed && session?.user.role === "employee" && folder === "just-catalog-import") {
    allowed = await canManageJustCatalog();
  }
  // Comprobante del pago individual a cada colaborador (después de que
  // Nairoby ya tiene el total en su poder) — lo sube ella, no el admin, a
  // diferencia de payroll-transfer-proofs (esa la sube el admin, cubierto
  // por el bypass de role==="admin" arriba, nunca tuvo entrada propia acá).
  if (!allowed && session?.user.role === "employee" && folder === "payroll-individual-payment-proofs") {
    allowed = await canEditPayrollRoles();
  }
  if (!allowed) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  if (size > MAX_BYTES) {
    return NextResponse.json({ error: "El archivo es muy pesado (máximo 50 MB)." }, { status: 400 });
  }

  const safeFolder = folder.replace(/[^a-z0-9-]/gi, "_");
  const safeName = fileName.replace(/[^a-z0-9.\-_]/gi, "_");
  const path = `${safeFolder}/${crypto.randomUUID()}-${safeName}`;

  try {
    await ensureBucket();
    const supabase = supabaseAdmin();
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      console.error("[upload/sign] Supabase error:", error);
      return NextResponse.json(
        { error: `No se pudo iniciar la subida: ${error?.message ?? "error desconocido"}.` },
        { status: 500 }
      );
    }

    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({
      signedUrl: data.signedUrl,
      token: data.token,
      path,
      publicUrl: publicData.publicUrl,
      fileName,
    });
  } catch (err) {
    console.error("[upload/sign] unexpected error:", err);
    const reason = err instanceof Error ? err.message : "error desconocido";
    return NextResponse.json({ error: `No se pudo iniciar la subida: ${reason}.` }, { status: 500 });
  }
}
