import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessNick, dbUserId } from "@/lib/guards";
import { decryptNick } from "@/lib/nick/crypto";
import { NICK_CALLBACK_PATH, NICK_OAUTH_COOKIE, exchangeCode, getOrRegisterClient, saveTokens } from "@/lib/nick/dropiOAuth";

// Dropi devuelve aquí después de que Daniel entra en su ventana oficial.
export async function GET(req: NextRequest) {
  const session = await auth();
  const sealed = req.cookies.get(NICK_OAUTH_COOKIE)?.value;
  const saved = sealed ? decryptNick(sealed) : null;
  const flow = saved ? (JSON.parse(saved) as { state: string; verifier: string; accountId: string; back: string; userId: string }) : null;
  const back = flow?.back ?? (session?.user.role === "admin" ? "/admin/nick" : "/area/nick");

  const done = (query: string) => {
    const res = NextResponse.redirect(new URL(`${back}?${query}`, req.nextUrl));
    res.cookies.delete({ name: NICK_OAUTH_COOKIE, path: "/api/nick/dropi" });
    return res;
  };

  if (!session || !(await canAccessNick())) return done("error=permiso");
  if (!flow || flow.userId !== session.user.id) return done("error=vencido");
  const p = req.nextUrl.searchParams;
  if (p.get("error")) return done("error=cancelado");
  const code = p.get("code");
  if (!code || p.get("state") !== flow.state) return done("error=vencido");

  const redirectUri = `${req.nextUrl.origin}${NICK_CALLBACK_PATH}`;
  try {
    const clientId = await getOrRegisterClient(redirectUri);
    const t = await exchangeCode({ code, verifier: flow.verifier, clientId, redirectUri });
    if (!t.access_token) return done("error=permiso_dropi");
    await saveTokens(flow.accountId, t, { byId: dbUserId(session.user.id) });
  } catch {
    return done("error=permiso_dropi");
  }
  return done(`ok=${encodeURIComponent(flow.accountId)}`);
}
