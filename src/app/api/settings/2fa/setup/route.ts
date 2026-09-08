import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/guards";
import { generateTwoFactorSecret, twoFactorOtpauthUrl, twoFactorQrDataUrl } from "@/lib/twoFactor";

// Genera un secreto NUEVO cada vez que se llama — no se guarda nada todavía,
// eso pasa recién en /confirm cuando el admin demuestra que lo escaneó.
export async function POST() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const secret = generateTwoFactorSecret();
  const otpauthUrl = twoFactorOtpauthUrl("Administrador (DAFLOW)", secret);
  const qrDataUrl = await twoFactorQrDataUrl(otpauthUrl);
  return NextResponse.json({ secret, qrDataUrl });
}
