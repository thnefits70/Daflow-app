import crypto from "crypto";
import { cookies } from "next/headers";
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";

// Confirmado 2026-09-24, pedido explícito del usuario: la hoja de CHEN solo
// la abre alguien cuyo correo el admin agregó a la lista (SupplierSheetEmail),
// aunque tenga el enlace. Entra con un código de 6 dígitos que le llega a ese
// correo y queda con sesión abierta en ese dispositivo (cookie httpOnly).

export const SHEET_SESSION_COOKIE = "hoja_sesion";
export const SHEET_SESSION_DAYS = 30;
export const SHEET_CODE_MINUTES = 10;
export const SHEET_CODE_MAX_ATTEMPTS = 5;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export type SheetViewer = { emailId: string; email: string; canWrite: boolean };

// Quién está viendo la hoja de ESTE proveedor — null si no hay sesión válida,
// si venció, o si el admin ya quitó su correo de la lista (al borrar el
// correo se borran sus sesiones en cascada).
export async function getSheetViewer(supplierId: string): Promise<SheetViewer | null> {
  const raw = (await cookies()).get(SHEET_SESSION_COOKIE)?.value;
  if (!raw) return null;
  const session = await prisma.supplierSheetSession.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { sheetEmail: true },
  });
  if (!session || session.expiresAt < new Date() || session.sheetEmail.supplierId !== supplierId) return null;

  const last = session.sheetEmail.lastAccessAt;
  if (!last || Date.now() - last.getTime() > 5 * 60 * 1000) {
    await prisma.supplierSheetEmail.update({ where: { id: session.emailId }, data: { lastAccessAt: new Date() } }).catch(() => {});
  }
  return { emailId: session.emailId, email: session.sheetEmail.email, canWrite: session.sheetEmail.canWrite };
}

// El correo sale desde el dominio de CHEN, nunca con el nombre de DAFLOW —
// ese dominio existe justamente para no mostrar nuestro nombre. Requiere que
// el dominio esté verificado en Resend (SUPPLIER_SHEET_EMAIL_FROM).
export async function sendSheetLoginCode(to: string, code: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === "tu-resend-api-key") {
    console.error("RESEND_API_KEY no está configurada. No se pudo enviar el código de la hoja.");
    return { ok: false };
  }
  const from = process.env.SUPPLIER_SHEET_EMAIL_FROM || "Acceso <acceso@dunxingchen.cc>";
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to,
    subject: `Tu código de acceso: ${code}`,
    html: `
      <div style="font-family: sans-serif; max-width: 420px; margin: 0 auto;">
        <p>Tu código para entrar a la hoja de cálculo es:</p>
        <p style="font-size: 30px; font-weight: 700; letter-spacing: 6px; margin: 16px 0;">${code}</p>
        <p style="color:#666; font-size: 13px;">Vence en ${SHEET_CODE_MINUTES} minutos. Si no lo pediste, ignora este correo.</p>
      </div>
    `,
  });
  if (error) {
    console.error("Error enviando código de la hoja:", error);
    return { ok: false };
  }
  return { ok: true };
}
