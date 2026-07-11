import { NextResponse } from "next/server";
import { auth } from "@/auth";

export default auth((req) => {
  const { pathname } = req.nextUrl;
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
  matcher: ["/admin/:path*", "/area/:path*", "/login"],
};
