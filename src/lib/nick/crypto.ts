import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// NICK guarda el permiso de Dropi (y la cookie del inicio de sesión) cifrado
// con AES-256-GCM. La llave sale de AUTH_SECRET, así que si alguien lee la
// tabla NickDropiAccount sin el secreto del servidor no puede usar el permiso.
function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Falta AUTH_SECRET");
  return createHash("sha256").update(`nick-dropi:${secret}`).digest();
}

export function encryptNick(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

export function decryptNick(sealed: string): string | null {
  try {
    const [iv, tag, enc] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
