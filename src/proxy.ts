import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Confirmado 2026-09-15, bug real reportado por el usuario: el dominio
// propio de CHEN (dunxingchen.cc, ver NEXT_PUBLIC_SUPPLIER_LEDGER_DOMAIN)
// apunta al MISMO deployment de Vercel que la app completa — Vercel sirve
// cualquier ruta en cualquier dominio configurado, así que
// dunxingchen.cc/login (o cualquier otra ruta) mostraba el login/la app
// entera de DAFLOW, exactamente lo que ese dominio existe para ocultar. Acá
// se bloquea: en ESE dominio, solo se deja pasar la página del proveedor y
// sus rutas de apoyo (firma/subida de foto) — cualquier otra ruta responde
// 404 liso, sin revelar nada de DAFLOW.
const SUPPLIER_LEDGER_DOMAIN = process.env.NEXT_PUBLIC_SUPPLIER_LEDGER_DOMAIN;
const SUPPLIER_LEDGER_ALLOWED_PREFIXES = ["/proveedor-ledger", "/api/proveedor-ledger"];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (SUPPLIER_LEDGER_DOMAIN && req.nextUrl.hostname === SUPPLIER_LEDGER_DOMAIN) {
    const allowed = SUPPLIER_LEDGER_ALLOWED_PREFIXES.some((p) => pathname.startsWith(p));
    return allowed ? NextResponse.next() : new NextResponse(null, { status: 404 });
  }

  const session = req.auth;

  const isAuthRoute = pathname === "/login";
  const isAdminRoute = pathname.startsWith("/admin");
  const isAreaRoute = pathname.startsWith("/area");

  if (!session && (isAdminRoute || isAreaRoute)) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  if (session && isAuthRoute) {
    const dest = session.user.role === "admin" ? "/admin" : "/area";
    return NextResponse.redirect(new URL(dest, req.nextUrl));
  }
  if (session && isAdminRoute && session.user.role !== "admin") {
    return NextResponse.redirect(new URL("/area", req.nextUrl));
  }
  if (session && isAreaRoute && session.user.role !== "employee") {
    return NextResponse.redirect(new URL("/admin", req.nextUrl));
  }
  return NextResponse.next();
});

export const config = {
  // Confirmado 2026-09-15: antes solo corría en /admin, /area y /login —
  // eso alcanzaba para el guard de sesión, pero dejaba pasar sin revisar
  // cualquier otra ruta (incluida /proveedor-ledger) en el dominio de CHEN.
  // Excluye solo los assets estáticos (no necesitan ningún chequeo).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
