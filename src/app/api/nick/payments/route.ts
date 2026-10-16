import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { getNickPayments } from "@/lib/nick/payments";
import { importWallet } from "@/lib/nick/wallet";

export const maxDuration = 60;

// Cruce de pagos de NICK: por ahora SOLO el admin sube y ve (pedido del
// usuario 2026-10-16; Nairoby después, cuando él lo decida).
export async function GET(req: NextRequest) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const p = req.nextUrl.searchParams;
  return NextResponse.json(await getNickPayments({ account: p.get("account") || null, month: p.get("month") || null }));
}

// Subir el Excel "Historial de cartera" de una cuenta.
export async function POST(req: NextRequest) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const accountId = String(form?.get("account") ?? "");
  if (!(file instanceof File)) return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });
  if (!(await prisma.nickDropiAccount.findUnique({ where: { id: accountId }, select: { id: true } })))
    return NextResponse.json({ error: "Elige de qué cuenta es el archivo." }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "El archivo es muy grande (máx. 15 MB)." }, { status: 400 });
  try {
    const r = await importWallet({ accountId, fileName: file.name, buf: Buffer.from(await file.arrayBuffer()), uploadedById: null });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo leer el archivo." }, { status: 400 });
  }
}
