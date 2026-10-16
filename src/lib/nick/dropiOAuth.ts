import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { decryptNick, encryptNick } from "@/lib/nick/crypto";

// Conector OFICIAL de Dropi (el mismo que Dropi anuncia en el portal de
// proveedores para conectar "tu agente de IA"). Datos públicos sacados de
// https://mcp.dropi.co/.well-known/oauth-protected-resource y de
// https://integrations.dropi.co/bff/.well-known/oauth-authorization-server
// (revisados 2026-10-15). Daniel entra en la ventana de Dropi; DAFLOW nunca
// ve su clave, solo recibe el permiso de lectura.
export const DROPI_MCP_URL = "https://mcp.dropi.co/mcp";
const AUTHORIZE_URL = "https://oauth.dropi.co/oauth/authorize";
const TOKEN_URL = "https://integrations.dropi.co/oauth/token";
const REGISTER_URL = "https://integrations.dropi.co/oauth/register";
const REVOKE_URL = "https://integrations.dropi.co/oauth/revoke";
const SCOPE = "mcp";

export const NICK_CALLBACK_PATH = "/api/nick/dropi/callback";
// Cookie cifrada que guarda el paso intermedio del inicio de sesión (15 min).
export const NICK_OAUTH_COOKIE = "nick_dropi_oauth";

// DAFLOW se registra una sola vez por dirección de regreso (registro
// automático que Dropi permite a cualquier conector) y guarda el client_id.
export async function getOrRegisterClient(redirectUri: string): Promise<string> {
  const existing = await prisma.nickOAuthClient.findUnique({ where: { redirectUri } });
  if (existing) return existing.clientId;
  const res = await fetch(REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "DAFLOW NICK",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!res.ok) throw new Error(`Dropi no aceptó registrar a DAFLOW (${res.status})`);
  const data = (await res.json()) as { client_id?: string };
  if (!data.client_id) throw new Error("Dropi no devolvió el registro de DAFLOW");
  await prisma.nickOAuthClient.create({ data: { redirectUri, clientId: data.client_id } });
  return data.client_id;
}

export function newPkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthorizeUrl(p: { clientId: string; redirectUri: string; challenge: string; state: string }) {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("code_challenge", p.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", p.state);
  u.searchParams.set("scope", SCOPE);
  u.searchParams.set("resource", DROPI_MCP_URL);
  return u.toString();
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };

async function postToken(params: Record<string, string>): Promise<TokenResponse & { status: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ ...params, resource: DROPI_MCP_URL }).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  return { ...data, status: res.status };
}

export async function exchangeCode(p: { code: string; verifier: string; clientId: string; redirectUri: string }) {
  return postToken({
    grant_type: "authorization_code",
    code: p.code,
    code_verifier: p.verifier,
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
  });
}

// Lo que Dropi dice de la cuenta conectada (si el permiso trae datos
// legibles) — sirve para que Daniel confirme que entró a la cuenta correcta.
export function identityFromToken(accessToken: string): string | null {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const out: string[] = [];
    for (const [k, v] of Object.entries(claims)) {
      if (!/name|email|store|company|shop|user|country|role|sub/i.test(k)) continue;
      if (/token|secret|password|wallet/i.test(k)) continue;
      if (typeof v === "string" || typeof v === "number") out.push(`${k}: ${v}`);
    }
    return out.length ? out.join(" · ").slice(0, 400) : null;
  } catch {
    return null;
  }
}

// `connect` va solo al conectar (no al renovar): guarda quién y cuándo.
// byId=null cuando conecta el admin (no tiene fila en User).
export async function saveTokens(accountId: string, t: TokenResponse, connect?: { byId: string | null }) {
  if (!t.access_token) throw new Error("Dropi no entregó el permiso");
  await prisma.nickDropiAccount.update({
    where: { id: accountId },
    data: {
      accessTokenEnc: encryptNick(t.access_token),
      ...(t.refresh_token ? { refreshTokenEnc: encryptNick(t.refresh_token) } : {}),
      tokenExpiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
      ...(connect
        ? { connectedById: connect.byId, connectedAt: new Date(), dropiIdentity: identityFromToken(t.access_token) }
        : {}),
      needsReconnect: false,
      lastError: null,
    },
  });
}

export class NickReconnectError extends Error {}

// Devuelve un permiso vigente; si está por vencer lo renueva solo. Si Dropi
// ya no lo acepta, marca la cuenta "Por reconectar" y lanza NickReconnectError.
export async function getValidAccessToken(accountId: string): Promise<string> {
  const acc = await prisma.nickDropiAccount.findUnique({ where: { id: accountId } });
  if (!acc?.accessTokenEnc) throw new NickReconnectError("La cuenta no está conectada.");
  const access = decryptNick(acc.accessTokenEnc);
  const fresh = !acc.tokenExpiresAt || acc.tokenExpiresAt.getTime() - Date.now() > 2 * 60 * 1000;
  if (access && fresh) return access;

  const refresh = acc.refreshTokenEnc ? decryptNick(acc.refreshTokenEnc) : null;
  const clients = await prisma.nickOAuthClient.findMany();
  if (!refresh || !clients.length) return markReconnect(accountId, "El permiso de Dropi venció.");
  // El refresh tiene que ir con el mismo client_id con el que se conectó
  // (normalmente hay uno solo: www.daflow.app).
  for (const c of clients) {
    const t = await postToken({ grant_type: "refresh_token", refresh_token: refresh, client_id: c.clientId });
    if (t.access_token) {
      await saveTokens(accountId, t);
      return t.access_token;
    }
  }
  return markReconnect(accountId, "Dropi pidió volver a conectar la cuenta.");
}

export async function markReconnect(accountId: string, reason: string): Promise<never> {
  await prisma.nickDropiAccount.update({ where: { id: accountId }, data: { needsReconnect: true, lastError: reason } });
  throw new NickReconnectError(reason);
}

export async function revokeAndClear(accountId: string) {
  const acc = await prisma.nickDropiAccount.findUnique({ where: { id: accountId } });
  const clients = await prisma.nickOAuthClient.findMany();
  for (const enc of [acc?.refreshTokenEnc, acc?.accessTokenEnc]) {
    const tok = enc ? decryptNick(enc) : null;
    if (!tok) continue;
    for (const c of clients) {
      await fetch(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tok, client_id: c.clientId }).toString(),
      }).catch(() => null);
    }
  }
  await prisma.nickDropiAccount.update({
    where: { id: accountId },
    data: {
      accessTokenEnc: null,
      refreshTokenEnc: null,
      tokenExpiresAt: null,
      dropiIdentity: null,
      connectedAt: null,
      connectedById: null,
      needsReconnect: false,
      lastError: null,
    },
  });
}
