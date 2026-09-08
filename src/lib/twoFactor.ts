import crypto from "crypto";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import bcrypt from "bcryptjs";

// Departamentos donde el autenticador de 2 pasos es obligatorio para todo el
// equipo (pedido explícito del usuario 2026-09-08): Inventario, Control de
// Compras y Finanzas. Mismo patrón que SUPPLIER_VIEW_DEPT_CODES en guards.ts
// — una lista de códigos en vez de una columna en Department.
export const TWO_FACTOR_REQUIRED_DEPT_CODES = ["INV", "COM", "FIN"];

export function generateTwoFactorSecret() {
  return authenticator.generateSecret();
}

export function twoFactorOtpauthUrl(accountLabel: string, secret: string) {
  return authenticator.keyuri(accountLabel, "DAFLOW", secret);
}

export function twoFactorQrDataUrl(otpauthUrl: string) {
  return QRCode.toDataURL(otpauthUrl);
}

export function verifyTwoFactorCode(token: string, secret: string) {
  try {
    return authenticator.verify({ token: token.trim(), secret });
  } catch {
    return false;
  }
}

// 8 códigos de un solo uso, formato "XXXX-XXXX" (fácil de transcribir a
// mano). Se devuelven en texto plano UNA vez (para mostrárselos al usuario)
// junto con sus hashes, que son lo único que se guarda en la base de datos.
export async function generateBackupCodes(count = 8) {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(4).toString("hex").toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  const hashes = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));
  return { codes, hashes };
}

// Busca `code` entre los hashes guardados. Si hay match, devuelve la lista
// de hashes SIN ese código (para persistirla de vuelta — cada código de
// respaldo sirve una sola vez). Si no hay match, devuelve null.
export async function consumeBackupCode(code: string, hashes: string[]): Promise<string[] | null> {
  const normalized = code.trim().toUpperCase();
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(normalized, hashes[i])) {
      return [...hashes.slice(0, i), ...hashes.slice(i + 1)];
    }
  }
  return null;
}

// Un código TOTP siempre son 6 dígitos; cualquier otra cosa (con guion,
// letras) se trata como código de respaldo. Usado para que el mismo campo de
// login acepte ambos sin que el usuario tenga que elegir un modo.
export function looksLikeTotpCode(code: string) {
  return /^\d{6}$/.test(code.trim());
}
