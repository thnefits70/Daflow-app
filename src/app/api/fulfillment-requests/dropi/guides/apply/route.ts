import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canSubmitFulfillmentRequest, dbUserId, getInventoryLeadId } from "@/lib/guards";
import { applyGuidesImport, ecuadorDay } from "@/lib/fulfillmentGuides";
import { cacheGuideLabelsForBatch } from "@/lib/localWarranty";
import { isManifestLate, manifestDeadline } from "@/lib/ecuadorHolidays";
import { notifyOwner } from "@/lib/notifications";
import { detectSuddenDemand } from "@/lib/suddenDemand";
import { notifyDiscontinuedSales } from "@/lib/dropiDiscontinued";
import { learnBrandsForNewCombos } from "@/lib/manifestBrand";

// Holgura para releer los PDF en segundo plano (marca de combos nuevos).
export const maxDuration = 300;

const carrierCounts = z.record(z.string().max(40), z.number().int().nonnegative());
const variantSchema = z.object({ label: z.string().trim().min(1).max(120), quantity: z.number().int().positive(), byCarrier: carrierCounts.optional() });
const schema = z.object({
  fileUrls: z.array(z.string().url()).min(1).max(40),
  manifestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  // Manifiesto atrasado: va al corte del día que dice el PDF (manifestDate).
  backfill: z.boolean().optional(),
  parseWarnings: z.array(z.string().max(1000)).max(400).optional(),
  guides: z.array(z.object({ number: z.string().trim().min(1).max(40), carrier: z.string().max(40), codes: z.array(z.string().max(120)).max(50).optional(), sender: z.string().max(120).nullable().optional() })).max(12000),
  rows: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(80),
        name: z.string().max(200),
        quantity: z.number().int().nonnegative(),
        byCarrier: z.record(z.string().max(40), z.number().int().nonnegative()),
        labelUnits: z.number().int().nonnegative(),
        labelUnitsByCarrier: carrierCounts.optional(),
        variants: z.array(variantSchema).max(50),
        decision: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("product"), catalogItemId: z.string().min(1), perUnit: z.number().int().min(1).max(50).optional() }),
          z.object({ kind: z.literal("combo"), comboCode: z.string().trim().min(1).max(30).optional() }),
          z.object({ kind: z.literal("ignore"), discontinued: z.boolean().optional() }),
        ]),
      })
    )
    .min(1)
    .max(1000),
  warranty: z
    .array(
      z.object({
        guide: z.string().trim().min(1).max(40),
        carrier: z.string().max(40),
        code: z.string().trim().min(1).max(80),
        quantity: z.number().int().positive(),
        variant: z.string().max(120).nullable(),
        decision: z.discriminatedUnion("mode", [
          z.object({ mode: z.literal("COMPLETE") }),
          z.object({ mode: z.literal("PARTIAL"), catalogItemIds: z.array(z.string().min(1)).min(1) }),
          z.object({ mode: z.literal("PIECE"), catalogItemId: z.string().min(1), piece: z.string().trim().min(1).max(200) }),
        ]),
        // Motivo de la garantía — de ahí sale solo el KPI de Garantías.
        reason: z.string().trim().min(1, "Elige el motivo de cada garantía.").max(80),
      })
    )
    .max(2000),
});

// Guarda la lectura del PDF de guías ya revisada por Yair en el corte
// abierto de hoy — y lo que la app "aprende" en el camino (ID de Dropi
// puesto a un producto que no lo tenía, IDs alternos, códigos marcados
// como "no es producto"). Ver src/lib/fulfillmentGuides.ts.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canSubmitFulfillmentRequest()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const { backfill, ...input } = parsed.data;
  if (backfill && !input.manifestDate) return NextResponse.json({ error: "No se pudo leer la fecha del manifiesto en el PDF." }, { status: 400 });
  const result = await applyGuidesImport({ ...input, backfillDay: backfill ? input.manifestDate : null }, dbUserId(session.user.id));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  // Combos / IDs alternos recién registrados toman la marca de su manifiesto
  // (en segundo plano: no demora el guardado). Ver lib/manifestBrand.ts.
  const comboCodes = input.rows.flatMap((r) => (r.decision.kind === "combo" && r.decision.comboCode ? [r.code, r.decision.comboCode] : [r.code]));
  after(() => learnBrandsForNewCombos(comboCodes, input.fileUrls).catch(() => null));
  // Productos y cantidades de cada guía, leídos una vez del PDF (pedido del
  // usuario 2026-10-02): así escanear una devolución en Reingreso es
  // instantáneo. En segundo plano, no demora el guardado.
  after(() => cacheGuideLabelsForBatch(result.batchId).catch(() => null));
  // Producto dado de baja que igual se vendió (pedido del usuario 2026-09-30):
  // Heidy lo da de baja en Dropi, Daniel/Bryan/Jariel quedan al tanto.
  if (result.discontinuedCount > 0) await notifyDiscontinuedSales(result.batchId).catch(() => null);
  if (backfill) {
    // Ya salió: no hay nada que sacar de bodega, solo que Daniel lo confirme.
    const danielId = await getInventoryLeadId();
    const day = input.manifestDate!.split("-").reverse().join("/");
    if (danielId) {
      await notifyOwner(danielId, {
        title: "Manifiesto atrasado por confirmar",
        body: `Se cargó el manifiesto del ${day}, que ya se despachó. No hay que sacar nada: entra al corte y confirma que salió todo para descontarlo del stock.`,
        url: "/area/workspace?tab=egresos&otab=solicitud",
      }).catch(() => null);
    }
    return NextResponse.json({ ok: true, batchId: result.batchId, lotId: result.lotId });
  }
  // Pedido del usuario 2026-10-02: el manifiesto se sube el mismo día o, a
  // más tardar, el siguiente día de trabajo (calendario de Ecuador). Si llega
  // después igual entra al corte de hoy y se escanea normal, pero se le
  // avisa al administrador.
  if (input.manifestDate) {
    const today = ecuadorDay(new Date());
    if (isManifestLate(input.manifestDate, today)) {
      const fmt = (d: string) => d.split("-").reverse().join("/");
      await notifyOwner("admin", {
        title: "⏰ Manifiesto subido fuera de plazo",
        body: `Se subió hoy el manifiesto del ${fmt(input.manifestDate)}; el plazo era hasta el ${fmt(manifestDeadline(input.manifestDate))}. Entró al corte de hoy.`,
        url: "/area/workspace?tab=egresos&otab=solicitud",
      }).catch(() => null);
    }
  }
  // Producto que despierta (pedido de Daniel 2026-09-29): se avisa el mismo
  // día en que sube el manifiesto. Si falla, la subida igual queda hecha y el
  // cron diario lo vuelve a revisar.
  await detectSuddenDemand().catch(() => null);
  return NextResponse.json({ ok: true, batchId: result.batchId, lotId: result.lotId });
}
