import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

// Google Maps' shortened share links (maps.app.goo.gl) can't be followed from
// the browser due to CORS, but a server can follow the redirect freely — this
// just resolves it to the final long URL so the client can pull @lat,lng out of it.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const url = req.nextUrl.searchParams.get("url");
  if (!url || !/^https:\/\/(maps\.app\.goo\.gl|goo\.gl)\//i.test(url)) {
    return NextResponse.json({ error: "Enlace inválido." }, { status: 400 });
  }

  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DAFLOW/1.0)" },
    });
    return NextResponse.json({ resolvedUrl: res.url });
  } catch {
    return NextResponse.json({ error: "No se pudo resolver el enlace." }, { status: 502 });
  }
}
