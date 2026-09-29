import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests, canActOnPurchaseApproval } from "@/lib/guards";
import {
  claimProofScope,
  computeClaimProofWarnings,
  findClaimProofDuplicates,
  hashProofFile,
  loadClaimProofContext,
  readClaimProof,
  signClaimProofRead,
  type ClaimProofRead,
} from "@/lib/claimProofCheck";

const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("no_envio"), proofUrl: z.string().url(), reportId: z.string().min(1), quantity: z.number().int().positive() }),
  z.object({ kind: z.literal("precio"), proofUrl: z.string().url(), requestId: z.string().min(1), newUnitCost: z.number().positive() }),
]);

// Confirmado 2026-09-29, pedido del usuario: UNA lectura de IA por captura
// (ver claimProofCheck.ts). Devuelve lo leído firmado + los avisos. No
// guarda nada — el guardado vuelve a revisar todo en el servidor.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const isAdmin = session.user.role === "admin";
  if (!isAdmin && !(await canSubmitPurchaseRequests()) && !(await canActOnPurchaseApproval())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const p = parsed.data;

  const target = p.kind === "no_envio" ? { kind: p.kind, reportId: p.reportId, quantity: p.quantity } : { kind: p.kind, requestId: p.requestId, newUnitCost: p.newUnitCost };
  const ctx = await loadClaimProofContext(target);
  if (!ctx) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const [proofHash, read] = await Promise.all([
    hashProofFile(p.proofUrl),
    readClaimProof({ ...ctx, proofUrl: p.proofUrl, actorId: session.user.id }).catch((err) => {
      console.error("[claim-proof/read] la IA no pudo leer la captura", err);
      return null as ClaimProofRead | null;
    }),
  ]);
  const duplicates = await findClaimProofDuplicates(proofHash);
  const warnings = computeClaimProofWarnings(read, ctx, duplicates);
  return NextResponse.json({ read, signature: signClaimProofRead(read, p.proofUrl, claimProofScope(target)), warnings });
}
