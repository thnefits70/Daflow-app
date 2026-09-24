import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { findSupplierByPublicSheetToken } from "@/lib/supplierDebt";
import {
  GOOGLE_SHEET_CALLBACK_PATH,
  GOOGLE_SHEET_STATE_COOKIE,
  googleSheetLoginEnabled,
  normalizeEmail,
  startSheetSession,
} from "@/lib/supplierSheetAccess";

// Confirmado 2026-09-24, pedido explícito del usuario: regreso de "Entrar con
// Google" a la hoja de CHEN. Solo abre sesión si Google confirma el correo y
// ese correo está en la lista del admin; si no, vuelve a la pantalla de
// entrada con un aviso. El intercambio del código se hace directo con Google
// (con la clave secreta), así que el correo que devuelve es confiable.
export async function GET(req: NextRequest) {
  const raw = req.cookies.get(GOOGLE_SHEET_STATE_COOKIE)?.value;
  let saved: { state?: string; token?: string } = {};
  try {
    saved = raw ? JSON.parse(raw) : {};
  } catch {}
  const token = saved.token;
  if (!token || !googleSheetLoginEnabled()) return new NextResponse(null, { status: 404 });

  const back = (error?: string) => {
    const url = new URL(`/proveedor-ledger/hoja/${token}`, req.nextUrl.origin);
    if (error) url.searchParams.set("error", error);
    const res = NextResponse.redirect(url);
    res.cookies.set(GOOGLE_SHEET_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  const state = req.nextUrl.searchParams.get("state") ?? "";
  const code = req.nextUrl.searchParams.get("code");
  const a = Buffer.from(state);
  const b = Buffer.from(saved.state ?? "");
  if (!code || !saved.state || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return back("google");

  const supplier = await findSupplierByPublicSheetToken(token);
  if (!supplier || supplier.paymentMode !== "CREDITO") return new NextResponse(null, { status: 404 });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_SHEET_CLIENT_ID!,
      client_secret: process.env.GOOGLE_SHEET_CLIENT_SECRET!,
      redirect_uri: `${req.nextUrl.origin}${GOOGLE_SHEET_CALLBACK_PATH}`,
      grant_type: "authorization_code",
    }),
  }).catch(() => null);
  if (!tokenRes?.ok) return back("google");
  const { id_token } = (await tokenRes.json()) as { id_token?: string };
  if (!id_token) return back("google");

  let claims: { aud?: string; email?: string; email_verified?: boolean; iss?: string; exp?: number } = {};
  try {
    claims = JSON.parse(Buffer.from(id_token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return back("google");
  }
  const validIssuer = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!validIssuer || claims.aud !== process.env.GOOGLE_SHEET_CLIENT_ID || !claims.email || !claims.email_verified || (claims.exp ?? 0) * 1000 < Date.now()) {
    return back("google");
  }

  const row = await prisma.supplierSheetEmail.findUnique({
    where: { supplierId_email: { supplierId: supplier.id, email: normalizeEmail(claims.email) } },
  });
  if (!row) return back("noacceso");

  return startSheetSession(back(), row.id);
}
