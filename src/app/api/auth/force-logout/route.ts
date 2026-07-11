import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

// Clears the session cookie directly instead of relying on the client-side
// signOut() flow. Used when a valid JWT points at a user/admin record that
// no longer exists (e.g. their account was deleted while they were logged
// in) — redirecting straight to /login would just bounce them back here
// because the (still valid) JWT survives the deleted row.
export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  for (const name of ["authjs.session-token", "__Secure-authjs.session-token"]) {
    cookieStore.delete(name);
  }
  return NextResponse.redirect(new URL("/login", req.url));
}
