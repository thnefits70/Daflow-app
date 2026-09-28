import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { parseGuidesPdf } from "@/lib/dropiGuidesPdf";
import { learnBrandsFromManifest, type ManifestBrandConflict } from "@/lib/manifestBrand";

export const maxDuration = 60;

async function isAdmin() {
  const session = await auth();
  return session?.user.role === "admin";
}

// Pedido del usuario 2026-09-28: botón (solo admin) que vuelve a leer los PDF
// de guías que Yair ya subió, para que los IDs existentes (sobre todo combos)
// tomen su marca del manifiesto de una vez. La pantalla pide la lista y
// procesa una subida por llamada, para no pasarse del tiempo máximo.
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const batches = await prisma.fulfillmentRequestBatch.findMany({
    where: { fileUrls: { isEmpty: false } },
    orderBy: { requestedAt: "asc" },
    select: { id: true },
  });
  return NextResponse.json({ batchIds: batches.map((b) => b.id) });
}

const schema = z.object({ batchId: z.string().min(1) });

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const batch = await prisma.fulfillmentRequestBatch.findUnique({ where: { id: parsed.data.batchId }, select: { fileUrls: true } });
  if (!batch) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const combos: string[] = [];
  const products: string[] = [];
  const conflicts: ManifestBrandConflict[] = [];
  let unread = 0;
  for (const url of batch.fileUrls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        unread++;
        continue;
      }
      const r = await parseGuidesPdf(new Uint8Array(await res.arrayBuffer()));
      if (r.source !== "DROPI") continue;
      const learned = await learnBrandsFromManifest([...r.lines.map((l) => l.code), ...r.warranty.map((w) => w.code)]);
      combos.push(...learned.combos);
      products.push(...learned.products);
      conflicts.push(...learned.conflicts);
    } catch {
      unread++;
    }
  }
  return NextResponse.json({ combos, products, conflicts, unread });
}
