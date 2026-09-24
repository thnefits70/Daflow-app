import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { findSupplierByPublicSheetToken } from "@/lib/supplierDebt";
import { GOOGLE_SHEET_CALLBACK_PATH, GOOGLE_SHEET_STATE_COOKIE, googleSheetLoginEnabled } from "@/lib/supplierSheetAccess";

// Confirmado 2026-09-24, pedido explícito del usuario: "Entrar con Google" en
// la hoja de CHEN. Manda a la persona a Google; al volver (hoja-google/callback)
// solo entra si su Gmail está en la lista del admin. El token de la hoja viaja
// en una cookie de corta duración junto con un valor al azar (state) para que
// nadie pueda fabricar el regreso.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supplier = await findSupplierByPublicSheetToken(token);
  if (!supplier || supplier.paymentMode !== "CREDITO" || !googleSheetLoginEnabled()) {
    return new NextResponse(null, { status: 404 });
  }

  const state = crypto.randomBytes(24).toString("hex");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_SHEET_CLIENT_ID!);
  url.searchParams.set("redirect_uri", `${req.nextUrl.origin}${GOOGLE_SHEET_CALLBACK_PATH}`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(url);
  res.cookies.set(GOOGLE_SHEET_STATE_COOKIE, JSON.stringify({ state, token }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
