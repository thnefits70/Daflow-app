import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { findSupplierByPublicSheetToken } from "@/lib/supplierDebt";
import { SHEET_CODE_MAX_ATTEMPTS, normalizeEmail, sha256, startSheetSession } from "@/lib/supplierSheetAccess";

// Confirmado 2026-09-24, pedido explícito del usuario: paso 2 — el código de
// 6 dígitos que le llegó al correo. Máximo 5 intentos por código; si acierta,
// queda con sesión abierta 30 días en ese dispositivo.
const schema = z.object({ email: z.string().trim().email().max(200), code: z.string().trim().regex(/^\d{6}$/) });
const WRONG = "Código incorrecto o vencido.";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supplier = await findSupplierByPublicSheetToken(token);
  if (!supplier || supplier.paymentMode !== "CREDITO") return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Escribe los 6 números del código." }, { status: 400 });
  const email = normalizeEmail(parsed.data.email);

  const row = await prisma.supplierSheetEmail.findUnique({ where: { supplierId_email: { supplierId: supplier.id, email } } });
  if (!row) return NextResponse.json({ error: WRONG }, { status: 400 });

  const code = await prisma.supplierSheetLoginCode.findFirst({
    where: { emailId: row.id, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!code || code.attempts >= SHEET_CODE_MAX_ATTEMPTS) return NextResponse.json({ error: WRONG }, { status: 400 });

  const given = Buffer.from(sha256(`${row.id}:${parsed.data.code}`));
  const expected = Buffer.from(code.codeHash);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    await prisma.supplierSheetLoginCode.update({ where: { id: code.id }, data: { attempts: { increment: 1 } } });
    return NextResponse.json({ error: WRONG }, { status: 400 });
  }

  await prisma.supplierSheetLoginCode.update({ where: { id: code.id }, data: { usedAt: new Date() } });
  return startSheetSession(NextResponse.json({ ok: true }), row.id);
}
