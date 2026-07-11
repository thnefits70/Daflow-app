import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";
import { hashPassword } from "@/lib/password";

const schema = z.object({
  logoUrl: z.string().nullable().optional(),
  bannerUrl: z.string().nullable().optional(),
  adminEmail: z.string().trim().nullable().optional(),
  newPassword: z.string().min(6, "La contraseña debe tener al menos 6 caracteres.").optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  const data: Record<string, unknown> = {};
  if (d.logoUrl !== undefined) data.logoUrl = d.logoUrl;
  if (d.bannerUrl !== undefined) data.bannerUrl = d.bannerUrl;
  if (d.adminEmail !== undefined) data.adminEmail = d.adminEmail || null;
  if (d.newPassword) data.adminPasswordHash = await hashPassword(d.newPassword);

  const settings = await prisma.platformSettings.update({ where: { id: "singleton" }, data });
  return NextResponse.json({ logoUrl: settings.logoUrl, bannerUrl: settings.bannerUrl, adminEmail: settings.adminEmail });
}
