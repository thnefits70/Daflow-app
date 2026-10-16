import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessNick } from "@/lib/guards";
import { encryptNick } from "@/lib/nick/crypto";
import { NICK_CALLBACK_PATH, NICK_OAUTH_COOKIE, buildAuthorizeUrl, getOrRegisterClient, newPkce } from "@/lib/nick/dropiOAuth";

// Botón "Conectar" de NICK: manda a la ventana OFICIAL de Dropi. La clave y
// el 2FA se escriben allá, nunca en DAFLOW.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canAccessNick())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const accountId = req.nextUrl.searchParams.get("account") ?? "";
  const account = await prisma.nickDropiAccount.findUnique({ where: { id: accountId }, select: { id: true } });
  if (!account) return NextResponse.json({ error: "Cuenta no encontrada." }, { status: 404 });

  const back = session.user.role === "admin" ? "/admin/nick" : "/area/nick";
  const redirectUri = `${req.nextUrl.origin}${NICK_CALLBACK_PATH}`;
  let clientId: string;
  try {
    clientId = await getOrRegisterClient(redirectUri);
  } catch {
    return NextResponse.redirect(new URL(`${back}?error=registro`, req.nextUrl));
  }
  const { verifier, challenge } = newPkce();
  const state = randomBytes(16).toString("base64url");
  const res = NextResponse.redirect(buildAuthorizeUrl({ clientId, redirectUri, challenge, state }));
  res.cookies.set(NICK_OAUTH_COOKIE, encryptNick(JSON.stringify({ state, verifier, accountId, back, userId: session.user.id })), {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/nick/dropi",
    maxAge: 15 * 60,
  });
  return res;
}
