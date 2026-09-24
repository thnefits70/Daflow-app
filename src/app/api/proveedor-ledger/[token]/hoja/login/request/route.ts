import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { findSupplierByPublicSheetToken } from "@/lib/supplierDebt";
import { SHEET_CODE_MINUTES, normalizeEmail, sendSheetLoginCode, sha256 } from "@/lib/supplierSheetAccess";

// Confirmado 2026-09-24, pedido explícito del usuario: paso 1 para entrar a
// la hoja de CHEN — escribe su correo y, SOLO si está en la lista que cargó
// el admin, le llega un código de 6 dígitos. La respuesta es la misma esté o
// no en la lista, para no revelar qué correos tienen acceso.
const schema = z.object({ email: z.string().trim().email().max(200) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supplier = await findSupplierByPublicSheetToken(token);
  if (!supplier || supplier.paymentMode !== "CREDITO") return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Escribe un correo válido." }, { status: 400 });
  const email = normalizeEmail(parsed.data.email);

  const row = await prisma.supplierSheetEmail.findUnique({ where: { supplierId_email: { supplierId: supplier.id, email } } });
  if (!row) return NextResponse.json({ ok: true });

  // Máximo un código por minuto por correo.
  const recent = await prisma.supplierSheetLoginCode.findFirst({
    where: { emailId: row.id, createdAt: { gt: new Date(Date.now() - 60 * 1000) } },
  });
  if (recent) return NextResponse.json({ ok: true });

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.supplierSheetLoginCode.create({
    data: { emailId: row.id, codeHash: sha256(`${row.id}:${code}`), expiresAt: new Date(Date.now() + SHEET_CODE_MINUTES * 60 * 1000) },
  });
  const sent = await sendSheetLoginCode(email, code);
  if (!sent.ok) return NextResponse.json({ error: "No se pudo enviar el código. Intenta de nuevo en unos minutos." }, { status: 502 });
  return NextResponse.json({ ok: true });
}
