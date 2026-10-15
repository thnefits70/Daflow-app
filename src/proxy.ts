import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { isProvedixHost, PROVEDIX_PUBLIC_PREFIXES } from "@/lib/provedixHosts";

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

// provedix.com (etapa 3, 2026-10-12): mismo criterio — la raíz muestra la
// página pública (/pvx) y solo pasan sus rutas; todo lo demás, 404 liso.
// Archivo de verificación de Google Search Console (2026-10-13): no borrar,
// Google lo revisa de vez en cuando para confirmar que la página es nuestra.
// (2026-10-14: /api/auth/session y /api/app-version ya no pasan — la página
// pública no carga la sesión ni el aviso de versión de DAFLOW.)
const PROVEDIX_EXTRA_PATHS = ["/robots.txt", "/sitemap.xml", "/googleb11466063347423e.html"];
const PROVEDIX_SHARE_PATHS = ["/calculadora", "/michelle"];

// Seguridad de provedix.com (pedido del usuario 2026-10-14): la página solo
// puede cargar cosas de su propio dominio (nada de scripts de otros sitios),
// no se puede meter dentro de otra página (contra engaños por "marco") y el
// navegador siempre usa https.
const PROVEDIX_CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

function withProvedixSecurity(res: NextResponse): NextResponse {
  res.headers.set("Content-Security-Policy", PROVEDIX_CSP);
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  return res;
}

// provedix.com no pasa por el sistema de sesión de DAFLOW (2026-10-14): así
// no recibe sus cookies ni deja rastro de él en el navegador del visitante.
function provedixProxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  // Una sola dirección para Google (2026-10-13): www.provedix.com → provedix.com.
  if (req.nextUrl.hostname.toLowerCase().startsWith("www.")) {
    const url = req.nextUrl.clone();
    url.hostname = req.nextUrl.hostname.slice(4);
    url.port = "";
    return NextResponse.redirect(url, 308);
  }
  // Enlaces para compartir (2026-10-15): provedix.com/calculadora abre la
  // calculadora y provedix.com/michelle abre el chat de Michelle IA — es la
  // misma página; ella decide qué abrir según la dirección.
  if (pathname === "/" || PROVEDIX_SHARE_PATHS.includes(pathname)) return withProvedixSecurity(NextResponse.rewrite(new URL("/pvx", req.nextUrl)));
  const allowed = PROVEDIX_PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) || PROVEDIX_EXTRA_PATHS.includes(pathname);
  return allowed ? withProvedixSecurity(NextResponse.next()) : new NextResponse(null, { status: 404 });
}

export default function proxy(req: NextRequest, ctx: NextFetchEvent) {
  if (isProvedixHost(req.nextUrl.hostname)) return provedixProxy(req);
  return daflowProxy(req, ctx as never);
}

const daflowProxy = auth((req) => {
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
