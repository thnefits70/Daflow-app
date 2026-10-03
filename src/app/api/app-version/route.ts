import { NextResponse } from "next/server";

// Versión publicada en este momento (el commit que Vercel desplegó). La usa
// AppVersionWatcher para saber si la pantalla abierta quedó vieja.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { version: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
