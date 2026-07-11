import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/email";

export async function POST() {
  const settings = await prisma.platformSettings.findUnique({ where: { id: "singleton" } });

  // Always respond the same way, whether or not an email is configured,
  // so this endpoint doesn't leak configuration state.
  if (settings?.adminEmail) {
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await prisma.passwordResetToken.create({ data: { tokenHash, expiresAt } });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;
    await sendPasswordResetEmail(settings.adminEmail, resetUrl);
  }

  return NextResponse.json({ ok: true });
}
