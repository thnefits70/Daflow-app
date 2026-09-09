import crypto from "crypto";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import bcrypt from "bcryptjs";

// Departamentos donde el autenticador de 2 pasos es obligatorio para todo el
// equipo (pedido explícito del usuario 2026-09-08): Inventario, Control de
// Compras y Finanzas. Mismo patrón que SUPPLIER_VIEW_DEPT_CODES en guards.ts
// — una lista de códigos en vez de una columna en Department.
// Ampliado el mismo día: "Control de Compras" (COM) no tiene gente asignada
// de verdad — quien gestiona compras (Jariel) está organizativamente en
// Análisis de Mercado (MKT) vía el flag canManagePurchases, no por deptId.
// Se agrega MKT completo para cubrirlo a él (y de paso a Bryan Ríos, Heidy y
// Robert, que manejan proveedores/precios/Dropi de ese mismo equipo).
// Ampliado de nuevo 2026-09-08: se suman DIS (Diseño - Marketing) y FUL
// (Fulfillment) — pedido explícito del usuario, ya no queda ningún
// departamento con cuentas reales fuera del alcance obligatorio.
export const TWO_FACTOR_REQUIRED_DEPT_CODES = ["INV", "COM", "FIN", "MKT", "DIS", "FUL"];

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

const ENROLL_TOKEN_TTL_MS = 5 * 60 * 1000;

// Token firmado (no requiere guardar nada en la base de datos) que
// reemplaza pedir un código TOTP nuevo en la pantalla de "guarda tus
// códigos de respaldo". El código de 6 dígitos ya se verificó una vez en
// /api/auth/2fa-enroll-confirm; reenviar ESE MISMO código para terminar de
// entrar fallaba con "Código incorrecto" porque para cuando la persona
// copiaba sus códigos de respaldo y presionaba "continuar" (30-90s+ después)
// el código ya había vencido. Este token vale 5 minutos y queda atado a esa
// cuenta específica, así que cubre ese tramo sin volver a pedirle nada.
export function generateEnrollToken(mode: "admin" | "team", id: string) {
  const expires = Date.now() + ENROLL_TOKEN_TTL_MS;
  const payload = `${mode}:${id}:${expires}`;
  const sig = crypto.createHmac("sha256", process.env.AUTH_SECRET ?? "").update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export function verifyEnrollToken(token: string, mode: "admin" | "team", id: string): boolean {
  try {
    const [tMode, tId, tExpires, tSig] = Buffer.from(token, "base64url").toString("utf8").split(":");
    if (tMode !== mode || tId !== id || !tSig) return false;
    const expires = Number(tExpires);
    if (!Number.isFinite(expires) || Date.now() > expires) return false;
    const payload = `${tMode}:${tId}:${tExpires}`;
    const expectedSig = crypto.createHmac("sha256", process.env.AUTH_SECRET ?? "").update(payload).digest("hex");
    const a = Buffer.from(tSig, "hex");
    const b = Buffer.from(expectedSig, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
